"""Every test session gets its own empty data folder, so tests never touch a real user's data."""
import os
import sys
import tempfile

_TMP = tempfile.mkdtemp(prefix="mostocks-test-")
os.environ["HOME"] = _TMP
os.environ["APPDATA"] = _TMP
os.environ["XDG_DATA_HOME"] = os.path.join(_TMP, "data")
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "app"))
