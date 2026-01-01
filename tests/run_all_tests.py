#!/usr/bin/env python3
"""
Script to run all tests for the Atlas Image Editor project.
Runs backend unit tests, frontend tests, and integration tests.
"""

import os
import sys
import subprocess
import argparse
import time


def run_command(command, cwd=None, description=""):
    """Run a command and return the result."""
    print(f"\n{'='*60}")
    print(f"Running: {description or command}")
    print(f"{'='*60}")
    
    try:
        result = subprocess.run(
            command,
            shell=True,
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=300  # 5 minute timeout
        )
        
        if result.stdout:
            print(result.stdout)
        if result.stderr:
            print(result.stderr)
            
        return result.returncode == 0
    except subprocess.TimeoutExpired:
        print(f"Command timed out: {command}")
        return False
    except Exception as e:
        print(f"Error running command: {e}")
        return False


def check_dependencies():
    """Check if required dependencies are available."""
    print("Checking dependencies...")
    
    # Check Python
    try:
        import PIL
        import flask
        import pytest
        print("✓ Backend dependencies available")
    except ImportError as e:
        print(f"✗ Missing backend dependency: {e}")
        return False
    
    # Check Node.js
    node_check = subprocess.run(['node', '--version'], capture_output=True)
    npm_check = subprocess.run(['npm', '--version'], capture_output=True)
    
    if node_check.returncode != 0 or npm_check.returncode != 0:
        print("✗ Node.js or npm not available")
        return False
    
    print("✓ Frontend dependencies available")
    return True


def run_backend_tests(project_root):
    """Run backend unit tests."""
    backend_dir = os.path.join(project_root, 'backend')
    
    # Install test dependencies
    if not run_command(
        'pip3 install -r test_requirements.txt',
        cwd=backend_dir,
        description="Installing backend test dependencies"
    ):
        return False
    
    # Run pytest
    return run_command(
        'python3 -m pytest tests/ --verbose --tb=short',
        cwd=backend_dir,
        description="Running backend unit tests"
    )


def run_frontend_tests(project_root):
    """Run frontend tests."""
    frontend_dir = os.path.join(project_root, 'frontend')
    
    # Install dependencies if node_modules doesn't exist
    if not os.path.exists(os.path.join(frontend_dir, 'node_modules')):
        if not run_command(
            'npm install',
            cwd=frontend_dir,
            description="Installing frontend dependencies"
        ):
            return False
    
    # Run React tests
    return run_command(
        'npm test -- --coverage --watchAll=false',
        cwd=frontend_dir,
        description="Running frontend tests"
    )


def run_integration_tests(project_root):
    """Run integration tests."""
    tests_dir = os.path.join(project_root, 'tests')
    
    # Install additional dependencies for integration tests
    if not run_command(
        'pip3 install requests',
        description="Installing integration test dependencies"
    ):
        return False
    
    # Run integration tests
    return run_command(
        f'python3 -m pytest integration/ --verbose',
        cwd=tests_dir,
        description="Running integration tests"
    )


def run_compilation_checks(project_root):
    """Check if code compiles without running tests."""
    print("\n" + "="*60)
    print("Running compilation checks")
    print("="*60)
    
    # Check backend Python syntax
    backend_dir = os.path.join(project_root, 'backend')
    if not run_command(
        'python3 -m py_compile app.py',
        cwd=backend_dir,
        description="Checking backend Python syntax"
    ):
        return False
    
    # Check frontend build
    frontend_dir = os.path.join(project_root, 'frontend')
    if not run_command(
        'npm run build',
        cwd=frontend_dir,
        description="Checking frontend build"
    ):
        return False
    
    print("✓ All compilation checks passed")
    return True


def main():
    parser = argparse.ArgumentParser(description='Run Atlas Image Editor tests')
    parser.add_argument('--backend', action='store_true', help='Run only backend tests')
    parser.add_argument('--frontend', action='store_true', help='Run only frontend tests')
    parser.add_argument('--integration', action='store_true', help='Run only integration tests')
    parser.add_argument('--compile-only', action='store_true', help='Run only compilation checks')
    parser.add_argument('--skip-deps', action='store_true', help='Skip dependency checks')
    
    args = parser.parse_args()
    
    # Get project root directory
    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    print(f"Project root: {project_root}")
    
    # Check dependencies unless skipped
    if not args.skip_deps and not check_dependencies():
        print("❌ Dependency check failed. Install missing dependencies.")
        return 1
    
    results = []
    
    # Run compilation checks
    if args.compile_only or not any([args.backend, args.frontend, args.integration]):
        results.append(("Compilation", run_compilation_checks(project_root)))
        if args.compile_only:
            print_results(results)
            return 0 if all(result[1] for result in results) else 1
    
    # Run specific test suites based on arguments
    if args.backend or not any([args.backend, args.frontend, args.integration]):
        results.append(("Backend Tests", run_backend_tests(project_root)))
    
    if args.frontend or not any([args.backend, args.frontend, args.integration]):
        results.append(("Frontend Tests", run_frontend_tests(project_root)))
    
    if args.integration or not any([args.backend, args.frontend, args.integration]):
        results.append(("Integration Tests", run_integration_tests(project_root)))
    
    # Print summary
    print_results(results)
    
    # Return exit code
    return 0 if all(result[1] for result in results) else 1


def print_results(results):
    """Print test results summary."""
    print("\n" + "="*60)
    print("TEST RESULTS SUMMARY")
    print("="*60)
    
    for test_type, success in results:
        status = "✅ PASSED" if success else "❌ FAILED"
        print(f"{test_type:20s} {status}")
    
    total_tests = len(results)
    passed_tests = sum(1 for _, success in results if success)
    
    print(f"\nTotal: {passed_tests}/{total_tests} test suites passed")
    
    if passed_tests == total_tests:
        print("🎉 All tests passed!")
    else:
        print("💥 Some tests failed. Check output above for details.")


if __name__ == '__main__':
    sys.exit(main())