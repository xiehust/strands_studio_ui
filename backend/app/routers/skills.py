"""
Skill Library API routes.

- GET    /api/skills          : list imported skills
- POST   /api/skills/import   : import a skill (inline / https / git / s3)
- DELETE /api/skills/{name}   : delete an imported skill

Endpoints are sync `def`s on purpose: FastAPI runs them in a threadpool, so
blocking downloads (urllib / boto3) don't stall the event loop.
"""
import logging
from typing import Literal, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.services.skill_service import (
    SkillExistsError,
    SkillNotFoundError,
    SkillValidationError,
    skill_service,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["skills"])


class SkillImportRequest(BaseModel):
    source_type: Literal["inline", "git", "https", "s3"]

    # inline source
    name: Optional[str] = Field(None, description="Skill name (inline source)")
    description: Optional[str] = Field(None, description="Skill description (inline source)")
    instructions: Optional[str] = Field(None, description="Skill instructions markdown (inline source)")

    # https source
    url: Optional[str] = Field(None, description="URL of a raw SKILL.md file (https source)")

    # git source (public GitHub only)
    repo: Optional[str] = Field(None, description="GitHub repository as 'org/repo' (git source)")
    ref: Optional[str] = Field(None, description="Branch / tag / commit (git source, default HEAD)")
    path: Optional[str] = Field(None, description="Skill subdirectory within the repo (git source)")

    # s3 source
    s3_uri: Optional[str] = Field(None, description="s3://bucket/prefix of the skill directory (s3 source)")


@router.get("/skills")
def list_skills():
    """List imported skills (name/description/source_type/origin/imported_at)."""
    try:
        return {"skills": skill_service.list_skills()}
    except Exception as e:
        logger.error(f"Failed to list skills: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/skills/import")
def import_skill(request: SkillImportRequest):
    """Import a skill into the Studio library from one of the four sources."""
    logger.info(f"Skill import requested: source_type={request.source_type}")
    try:
        skill = skill_service.import_skill(
            request.source_type,
            name=request.name,
            description=request.description,
            instructions=request.instructions,
            url=request.url,
            repo=request.repo,
            ref=request.ref,
            path=request.path,
            s3_uri=request.s3_uri,
        )
        return {"skill": skill}
    except SkillExistsError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except SkillValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Skill import failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/skills/{name}")
def delete_skill(name: str):
    """Delete an imported skill from the library."""
    try:
        skill_service.delete_skill(name)
        return {"deleted": name}
    except SkillNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except SkillValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Skill delete failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
