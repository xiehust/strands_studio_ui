"""
Studio-managed Skill Library service.

Skills (https://strandsagents.com/docs/user-guide/concepts/plugins/skills/) are
imported ONCE into backend-local storage (`backend/storage/skills/{name}/`) and
distributed to the three consumption paths from there:

- local execution / chat subprocesses: via the STUDIO_SKILLS_DIR env var
- AgentCore deployment: skill directories are copied into the zip's `skills/`

Import sources (download happens only at import time, with Studio backend
credentials):

- inline : name/description/instructions form -> SKILL.md is generated
- https  : URL pointing at a raw SKILL.md file
- git    : public GitHub repo (repo/ref/path) via the codeload zip endpoint
           (no git binary required; private repos are not supported)
- s3     : s3://bucket/prefix full-directory download (boto3)

All sources go through the same pipeline: download into a temp directory,
validate (SKILL.md exists, frontmatter has name+description, name is a valid
skill name and matches the target directory name), then atomically move into
the storage root. Source metadata is stored in `.studio-meta.json` inside the
skill directory (strands ignores unknown files; directory skills are loaded
lazily by AgentSkills at init_agent time).
"""
import io
import json
import logging
import re
import shutil
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from strands.vended_plugins.skills.skill import Skill

logger = logging.getLogger(__name__)

# Storage root: backend/storage/skills (this file is backend/app/services/...)
SKILLS_ROOT = Path(__file__).parent.parent.parent / "storage" / "skills"

# Skill directory / frontmatter name rule (also a path-traversal guard)
SKILL_NAME_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")

# Per-skill size guard (protects against huge s3 prefixes / git subtrees)
MAX_SKILL_SIZE_BYTES = 50 * 1024 * 1024  # 50 MB

# HTTP download cap (raw SKILL.md files and git codeload zip archives)
MAX_DOWNLOAD_BYTES = MAX_SKILL_SIZE_BYTES * 4  # 200 MB

DOWNLOAD_TIMEOUT_S = 30
META_FILENAME = ".studio-meta.json"


class SkillValidationError(ValueError):
    """The skill content/source is invalid (HTTP 400)."""


class SkillExistsError(ValueError):
    """A skill with the same name is already imported (HTTP 409)."""


class SkillNotFoundError(LookupError):
    """No imported skill with that name (HTTP 404). LookupError (not KeyError):
    str(KeyError(msg)) adds repr quotes, which would leak into the API detail."""


class SkillService:
    """Manages the Studio skill library under `backend/storage/skills/`."""

    def __init__(self, skills_root: Path = SKILLS_ROOT):
        self.skills_root = Path(skills_root)
        self.skills_root.mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------------ list

    def list_skills(self) -> List[Dict[str, Any]]:
        """List imported skills with name/description/source metadata."""
        skills: List[Dict[str, Any]] = []
        for entry in sorted(self.skills_root.iterdir()):
            if not entry.is_dir():
                continue
            skill_md = self._find_skill_md(entry)
            if skill_md is None:
                logger.warning(f"Skill directory without SKILL.md ignored: {entry}")
                continue
            try:
                skill = Skill.from_content(skill_md.read_text(encoding="utf-8"))
            except Exception as e:
                logger.warning(f"Unparseable SKILL.md ignored: {entry} ({e})")
                continue
            meta = self._read_meta(entry)
            skills.append({
                "name": entry.name,
                "description": skill.description,
                "source_type": meta.get("source_type", "unknown"),
                "origin": meta.get("origin", ""),
                "imported_at": meta.get("imported_at", ""),
            })
        return skills

    def skill_dir(self, name: str) -> Path:
        """Absolute path of an imported skill directory (validates the name)."""
        if not SKILL_NAME_RE.match(name):
            raise SkillValidationError(
                f"Invalid skill name '{name}' (expected ^[a-z0-9][a-z0-9-]{{0,63}}$)"
            )
        return self.skills_root / name

    # ---------------------------------------------------------------- import

    def import_skill(
        self,
        source_type: str,
        *,
        # inline
        name: Optional[str] = None,
        description: Optional[str] = None,
        instructions: Optional[str] = None,
        # https
        url: Optional[str] = None,
        # git
        repo: Optional[str] = None,
        ref: Optional[str] = None,
        path: Optional[str] = None,
        # s3
        s3_uri: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Import a skill from one of the four sources into the library.

        Returns the list-shaped metadata dict of the imported skill.
        Raises SkillValidationError (400) / SkillExistsError (409).
        """
        with tempfile.TemporaryDirectory(prefix="skill-import-") as tmp:
            tmp_root = Path(tmp)
            if source_type == "inline":
                staged = self._stage_inline(tmp_root, name, description, instructions)
                origin = "inline"
            elif source_type == "https":
                staged = self._stage_https(tmp_root, url)
                origin = url or ""
            elif source_type == "git":
                staged = self._stage_git(tmp_root, repo, ref, path)
                origin = f"github:{repo}@{ref or 'HEAD'}/{path or ''}"
            elif source_type == "s3":
                staged = self._stage_s3(tmp_root, s3_uri)
                origin = s3_uri or ""
            else:
                raise SkillValidationError(f"Unknown source_type: {source_type}")

            skill = self._validate_staged(staged)
            self._enforce_size_limit(staged)

            # Frontmatter name is authoritative for the library directory name
            if staged.name != skill.name:
                logger.warning(
                    f"Skill frontmatter name '{skill.name}' differs from source "
                    f"directory '{staged.name}'; using frontmatter name"
                )

            target = self.skills_root / skill.name
            if target.exists():
                raise SkillExistsError(f"Skill '{skill.name}' is already imported")

            self._write_meta(staged, source_type, origin)
            shutil.move(str(staged), str(target))

        logger.info(f"Imported skill '{skill.name}' from {source_type} source ({origin})")
        meta = self._read_meta(target)
        return {
            "name": skill.name,
            "description": skill.description,
            "source_type": meta.get("source_type", source_type),
            "origin": meta.get("origin", origin),
            "imported_at": meta.get("imported_at", ""),
        }

    # ---------------------------------------------------------------- delete

    def delete_skill(self, name: str) -> None:
        """Delete an imported skill directory."""
        target = self.skill_dir(name)
        if not target.is_dir():
            raise SkillNotFoundError(f"Skill '{name}' not found")
        shutil.rmtree(target)
        logger.info(f"Deleted skill '{name}'")

    # ------------------------------------------------------- source stagers
    # Each stager returns the staged skill DIRECTORY inside tmp_root.

    def _stage_inline(
        self,
        tmp_root: Path,
        name: Optional[str],
        description: Optional[str],
        instructions: Optional[str],
    ) -> Path:
        if not name or not description:
            raise SkillValidationError("inline import requires 'name' and 'description'")
        if not SKILL_NAME_RE.match(name):
            raise SkillValidationError(
                f"Invalid skill name '{name}' (expected ^[a-z0-9][a-z0-9-]{{0,63}}$)"
            )
        skill_dir = tmp_root / name
        skill_dir.mkdir(parents=True)
        # yaml-safe frontmatter via json.dumps (JSON strings are valid YAML)
        frontmatter_name = json.dumps(name)
        frontmatter_desc = json.dumps(description)
        content = (
            f"---\n"
            f"name: {frontmatter_name}\n"
            f"description: {frontmatter_desc}\n"
            f"---\n\n"
            f"{(instructions or '').strip()}\n"
        )
        (skill_dir / "SKILL.md").write_text(content, encoding="utf-8")
        return skill_dir

    def _stage_https(self, tmp_root: Path, url: Optional[str]) -> Path:
        if not url or not url.startswith(("https://", "http://")):
            raise SkillValidationError("https import requires a valid http(s) 'url'")
        try:
            content = self._http_get(url).decode("utf-8")
        except UnicodeDecodeError:
            raise SkillValidationError(f"URL did not return UTF-8 text (expected a raw SKILL.md): {url}")
        # Validate before we know the directory name
        try:
            skill = Skill.from_content(content, strict=True)
        except ValueError as e:
            raise SkillValidationError(f"Downloaded content is not a valid SKILL.md: {e}")
        skill_dir = tmp_root / skill.name
        skill_dir.mkdir(parents=True)
        (skill_dir / "SKILL.md").write_text(content, encoding="utf-8")
        return skill_dir

    def _stage_git(
        self,
        tmp_root: Path,
        repo: Optional[str],
        ref: Optional[str],
        path: Optional[str],
    ) -> Path:
        """Download a public GitHub repo subdirectory via the codeload zip endpoint."""
        if not repo or "/" not in repo:
            raise SkillValidationError("git import requires 'repo' as 'org/repo'")
        repo = repo.strip().strip("/")
        # Accept full GitHub URLs for convenience
        repo = re.sub(r"^https?://github\.com/", "", repo)
        repo = re.sub(r"\.git$", "", repo)
        if not re.match(r"^[\w.-]+/[\w.-]+$", repo):
            raise SkillValidationError(f"Invalid git repo '{repo}' (expected 'org/repo')")
        ref = (ref or "HEAD").strip()
        zip_url = f"https://codeload.github.com/{repo}/zip/{urllib.parse.quote(ref)}"

        try:
            zip_bytes = self._http_get(zip_url)
        except SkillValidationError as e:
            raise SkillValidationError(
                f"Could not download {repo}@{ref} from GitHub (private repositories "
                f"are not supported): {e}"
            )

        extract_root = tmp_root / "_git_extract"
        extract_root.mkdir(parents=True)
        try:
            with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
                total = sum(i.file_size for i in zf.infolist())
                if total > MAX_SKILL_SIZE_BYTES * 4:
                    raise SkillValidationError(
                        f"Repository archive too large ({total / (1024 * 1024):.0f} MB unzipped)"
                    )
                zf.extractall(extract_root)
        except zipfile.BadZipFile:
            raise SkillValidationError(f"GitHub did not return a valid zip for {repo}@{ref}")

        # codeload zips contain a single top-level '{repo}-{ref}' directory
        top_dirs = [d for d in extract_root.iterdir() if d.is_dir()]
        if len(top_dirs) != 1:
            raise SkillValidationError("Unexpected GitHub archive layout (no unique top-level directory)")
        repo_root = top_dirs[0]

        sub = (path or "").strip().strip("/")
        source_dir = (repo_root / sub) if sub else repo_root
        source_dir = source_dir.resolve()
        if not str(source_dir).startswith(str(repo_root.resolve())):
            raise SkillValidationError(f"Invalid path '{path}' (escapes the repository)")
        if not source_dir.is_dir():
            raise SkillValidationError(f"Path '{sub}' not found in {repo}@{ref}")
        return source_dir

    def _stage_s3(self, tmp_root: Path, s3_uri: Optional[str]) -> Path:
        if not s3_uri or not s3_uri.startswith("s3://"):
            raise SkillValidationError("s3 import requires 's3_uri' like s3://bucket/prefix")
        parsed = urllib.parse.urlparse(s3_uri)
        bucket = parsed.netloc
        prefix = parsed.path.lstrip("/").rstrip("/")
        if not bucket or not prefix:
            raise SkillValidationError(f"Invalid s3 URI '{s3_uri}' (expected s3://bucket/prefix)")

        import boto3  # deferred: keep service importable without boto3
        s3 = boto3.client("s3")

        # Stage under the last prefix segment as the provisional directory name
        stage_dir = tmp_root / prefix.split("/")[-1]
        stage_dir.mkdir(parents=True)

        total = 0
        count = 0
        paginator = s3.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=bucket, Prefix=prefix + "/"):
            for obj in page.get("Contents", []):
                key = obj["Key"]
                rel = key[len(prefix) + 1:]
                if not rel or rel.endswith("/"):
                    continue  # folder placeholder objects
                total += obj.get("Size", 0)
                if total > MAX_SKILL_SIZE_BYTES:
                    raise SkillValidationError(
                        f"Skill at {s3_uri} exceeds the {MAX_SKILL_SIZE_BYTES // (1024 * 1024)} MB limit"
                    )
                local = stage_dir / rel
                if not str(local.resolve()).startswith(str(stage_dir.resolve())):
                    raise SkillValidationError(f"Unsafe object key in prefix: {key}")
                local.parent.mkdir(parents=True, exist_ok=True)
                s3.download_file(bucket, key, str(local))
                count += 1
        if count == 0:
            raise SkillValidationError(f"No objects found under {s3_uri}")
        return stage_dir

    # ----------------------------------------------------------- validation

    def _validate_staged(self, staged: Path) -> Skill:
        """Validate a staged skill directory; returns the parsed Skill."""
        skill_md = self._find_skill_md(staged)
        if skill_md is None:
            raise SkillValidationError("Skill has no SKILL.md file")
        try:
            skill = Skill.from_content(skill_md.read_text(encoding="utf-8"), strict=True)
        except ValueError as e:
            raise SkillValidationError(f"Invalid SKILL.md: {e}")
        if not SKILL_NAME_RE.match(skill.name):
            raise SkillValidationError(
                f"Invalid skill name '{skill.name}' (expected ^[a-z0-9][a-z0-9-]{{0,63}}$)"
            )
        return skill

    def _enforce_size_limit(self, staged: Path) -> None:
        total = sum(f.stat().st_size for f in staged.rglob("*") if f.is_file())
        if total > MAX_SKILL_SIZE_BYTES:
            raise SkillValidationError(
                f"Skill is {total / (1024 * 1024):.1f} MB, exceeding the "
                f"{MAX_SKILL_SIZE_BYTES // (1024 * 1024)} MB per-skill limit"
            )

    # -------------------------------------------------------------- helpers

    @staticmethod
    def _find_skill_md(skill_dir: Path) -> Optional[Path]:
        for candidate_name in ("SKILL.md", "skill.md"):
            candidate = skill_dir / candidate_name
            if candidate.is_file():
                return candidate
        return None

    @staticmethod
    def _http_get(url: str) -> bytes:
        request = urllib.request.Request(url, headers={"User-Agent": "strands-studio-skill-import"})
        try:
            with urllib.request.urlopen(request, timeout=DOWNLOAD_TIMEOUT_S) as resp:
                # Read one byte beyond the cap so we can tell "at limit" from "over limit"
                data = resp.read(MAX_DOWNLOAD_BYTES + 1)
                if len(data) > MAX_DOWNLOAD_BYTES:
                    raise SkillValidationError(
                        f"Download exceeds the {MAX_DOWNLOAD_BYTES // (1024 * 1024)} MB limit: {url}"
                    )
                return data
        except urllib.error.HTTPError as e:
            raise SkillValidationError(f"HTTP {e.code} fetching {url}")
        except urllib.error.URLError as e:
            raise SkillValidationError(f"Failed to fetch {url}: {e.reason}")
        except TimeoutError:
            raise SkillValidationError(f"Timed out fetching {url}")

    @staticmethod
    def _write_meta(skill_dir: Path, source_type: str, origin: str) -> None:
        meta = {
            "source_type": source_type,
            "origin": origin,
            "imported_at": datetime.now(timezone.utc).isoformat(),
        }
        (skill_dir / META_FILENAME).write_text(
            json.dumps(meta, indent=2) + "\n", encoding="utf-8"
        )

    @staticmethod
    def _read_meta(skill_dir: Path) -> Dict[str, Any]:
        meta_path = skill_dir / META_FILENAME
        if not meta_path.is_file():
            return {}
        try:
            return json.loads(meta_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return {}


# Module-level singleton (mirrors conversation_service pattern)
skill_service = SkillService()
