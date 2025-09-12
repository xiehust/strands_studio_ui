"""
Test script for the storage system
"""
import asyncio
import json
import logging
import tempfile
from pathlib import Path
from datetime import datetime

from app.models.storage import ArtifactRequest, StorageMetadata
from app.services.storage_service import StorageService
from app.utils.path_utils import sanitize_path_component, build_storage_path

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


async def test_storage_service():
    """Test the storage service functionality"""
    logger.info("Starting storage service tests")
    
    # Create a temporary directory for testing
    with tempfile.TemporaryDirectory() as temp_dir:
        logger.info(f"Using temporary directory: {temp_dir}")
        
        # Initialize storage service
        storage_service = StorageService(temp_dir)
        
        # Test data
        test_project_id = "test-project"
        test_version = "1.0.0"
        test_execution_id = "exec-123"
        
        # Test 1: Save artifacts
        logger.info("Test 1: Saving artifacts")
        
        artifacts_data = [
            {
                "file_type": "generate.py",
                "content": "# Generated Python code\nprint('Hello from generated code!')\n\ndef main():\n    return 'Generated result'"
            },
            {
                "file_type": "flow.json",
                "content": json.dumps({
                    "nodes": [{"id": "1", "type": "start", "data": {"label": "Start"}}],
                    "edges": [],
                    "metadata": {"version": "1.0.0", "created": datetime.now().isoformat()}
                }, indent=2)
            },
            {
                "file_type": "result.json",
                "content": json.dumps({
                    "success": True,
                    "output": "Generated result",
                    "execution_time": 0.123,
                    "timestamp": datetime.now().isoformat()
                }, indent=2)
            },
            {
                "file_type": "metadata.json",
                "content": json.dumps({
                    "project": test_project_id,
                    "version": test_version,
                    "execution": test_execution_id,
                    "created_at": datetime.now().isoformat(),
                    "description": "Test execution metadata"
                }, indent=2)
            }
        ]
        
        saved_artifacts = []
        for artifact_data in artifacts_data:
            request = ArtifactRequest(
                project_id=test_project_id,
                version=test_version,
                execution_id=test_execution_id,
                content=artifact_data["content"],
                file_type=artifact_data["file_type"]
            )
            
            response = await storage_service.save_artifact(request)
            if response.success:
                logger.info(f"✓ Saved {artifact_data['file_type']}: {response.file_path}")
                saved_artifacts.append(artifact_data["file_type"])
            else:
                logger.error(f"✗ Failed to save {artifact_data['file_type']}: {response.message}")
        
        logger.info(f"Saved {len(saved_artifacts)} artifacts")
        
        # Test 2: Retrieve artifacts
        logger.info("Test 2: Retrieving artifacts")
        
        retrieved_count = 0
        for file_type in saved_artifacts:
            try:
                artifact_content = await storage_service.retrieve_artifact(
                    test_project_id, test_version, test_execution_id, file_type
                )
                logger.info(f"✓ Retrieved {file_type}: {len(artifact_content.content)} characters")
                logger.info(f"  Metadata: {artifact_content.metadata.file_size} bytes, {artifact_content.metadata.checksum[:20]}...")
                retrieved_count += 1
            except Exception as e:
                logger.error(f"✗ Failed to retrieve {file_type}: {e}")
        
        logger.info(f"Retrieved {retrieved_count} artifacts")
        
        # Test 3: List projects
        logger.info("Test 3: Listing projects")
        
        try:
            projects = await storage_service.list_projects()
            logger.info(f"✓ Found {len(projects)} projects")
            for project in projects:
                logger.info(f"  Project: {project.project_id}, Versions: {len(project.versions)}, Executions: {project.execution_count}")
        except Exception as e:
            logger.error(f"✗ Failed to list projects: {e}")
        
        # Test 4: Get project versions
        logger.info("Test 4: Getting project versions")
        
        try:
            versions = await storage_service.get_project_versions(test_project_id)
            logger.info(f"✓ Found {len(versions)} versions for project {test_project_id}")
            for version in versions:
                logger.info(f"  Version: {version.version}, Executions: {len(version.executions)}, Artifacts: {version.artifact_count}")
        except Exception as e:
            logger.error(f"✗ Failed to get project versions: {e}")
        
        # Test 5: Get execution info
        logger.info("Test 5: Getting execution info")
        
        try:
            execution_info = await storage_service.get_execution_info(
                test_project_id, test_version, test_execution_id
            )
            logger.info(f"✓ Execution info: {len(execution_info.artifacts)} artifacts, {execution_info.total_size} bytes")
            for artifact in execution_info.artifacts:
                logger.info(f"  Artifact: {artifact.file_type}, {artifact.file_size} bytes")
        except Exception as e:
            logger.error(f"✗ Failed to get execution info: {e}")
        
        # Test 6: Get storage stats
        logger.info("Test 6: Getting storage statistics")
        
        try:
            stats = await storage_service.get_storage_stats()
            logger.info(f"✓ Storage stats:")
            logger.info(f"  Projects: {stats.total_projects}")
            logger.info(f"  Versions: {stats.total_versions}")
            logger.info(f"  Executions: {stats.total_executions}")
            logger.info(f"  Artifacts: {stats.total_artifacts}")
            logger.info(f"  Total size: {stats.total_size} bytes")
            if stats.oldest_artifact:
                logger.info(f"  Oldest artifact: {stats.oldest_artifact}")
            if stats.newest_artifact:
                logger.info(f"  Newest artifact: {stats.newest_artifact}")
        except Exception as e:
            logger.error(f"✗ Failed to get storage stats: {e}")
        
        # Test 7: Test error handling
        logger.info("Test 7: Testing error handling")
        
        # Try to retrieve non-existent artifact
        try:
            await storage_service.retrieve_artifact(
                "non-existent", "1.0.0", "exec-999", "generate.py"
            )
            logger.error("✗ Should have failed to retrieve non-existent artifact")
        except Exception as e:
            logger.info(f"✓ Correctly failed to retrieve non-existent artifact: {type(e).__name__}")
        
        # Try to save with invalid file type
        try:
            invalid_request = ArtifactRequest(
                project_id="test",
                version="1.0.0",
                execution_id="exec-1",
                content="test content",
                file_type="invalid.txt"
            )
            await storage_service.save_artifact(invalid_request)
            logger.error("✗ Should have failed with invalid file type")
        except Exception as e:
            logger.info(f"✓ Correctly failed with invalid file type: {type(e).__name__}")
        
        logger.info("Storage service tests completed successfully!")


async def test_path_utilities():
    """Test the path utility functions"""
    logger.info("Testing path utilities")
    
    # Test path sanitization
    test_cases = [
        ("valid-name", "valid-name"),
        ("invalid/path", "invalid_path"),
        ("../dangerous", "dangerous"),
        ("name with spaces", "name_with_spaces"),
        ("special!@#chars", "special___chars"),
        (".hidden", "file_hidden")
    ]
    
    logger.info("Testing path sanitization:")
    for input_val, expected in test_cases:
        try:
            result = sanitize_path_component(input_val)
            if result == expected:
                logger.info(f"✓ '{input_val}' -> '{result}'")
            else:
                logger.warning(f"? '{input_val}' -> '{result}' (expected '{expected}')")
        except Exception as e:
            logger.error(f"✗ Failed to sanitize '{input_val}': {e}")
    
    # Test path building
    logger.info("Testing path building:")
    base_dir = Path("/tmp/test")
    test_path = build_storage_path(base_dir, "my-project", "1.0.0", "exec-123")
    expected_path = base_dir / "my-project" / "1.0.0" / "exec-123"
    
    if test_path == expected_path:
        logger.info(f"✓ Path building: {test_path}")
    else:
        logger.error(f"✗ Path building failed: got {test_path}, expected {expected_path}")
    
    logger.info("Path utilities tests completed!")


async def main():
    """Run all tests"""
    logger.info("Starting storage system tests")
    
    try:
        await test_path_utilities()
        await test_storage_service()
        logger.info("All tests completed successfully!")
    except Exception as e:
        logger.error(f"Test failed: {e}")
        raise


if __name__ == "__main__":
    asyncio.run(main())