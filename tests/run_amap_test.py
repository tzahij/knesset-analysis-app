import os
import sys
import subprocess


def main():
    # Set up environment variables
    env = os.environ.copy()
    env["PGDATABASE"] = "knesset_test"

    # Define paths
    project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    data_dir = os.path.join(project_root, "data_test")
    mock_dir = os.path.join(project_root, "tests", "mocks", "amap_test")
    builder_script = os.path.join(
        project_root, "src", "python", "scrapers", "knesset_store_builder.py"
    )

    import shutil

    # Ensure data directory is fresh to force downloads
    if os.path.exists(data_dir):
        shutil.rmtree(data_dir)
    os.makedirs(data_dir, exist_ok=True)

    print("Running AMAP Test with Mock Data...")
    print(f"PGDATABASE: knesset_test")
    print(f"Data Dir: {data_dir}")
    print(f"Mock Dir: {mock_dir}")

    cmd = [
        sys.executable,
        builder_script,
        "--data-dir",
        data_dir,
        "--mock-dir",
        mock_dir,
        "--threads",
        "2",  # Keep low for testing
        "--model",
        "gemini-2.5-flash",
    ]

    result = subprocess.run(cmd, env=env, cwd=project_root)

    if result.returncode == 0:
        print("AMAP Test completed successfully!")
    else:
        print(f"AMAP Test failed with return code {result.returncode}")
        sys.exit(result.returncode)


if __name__ == "__main__":
    main()
