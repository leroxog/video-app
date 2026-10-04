"""Runs the Node tests of the browser-side rules (static/js/gomat-core.js: streak, hearts, XP, unlocking ...)."""
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
HERE = os.path.dirname(os.path.abspath(__file__))


@pytest.mark.skipif(NODE is None, reason="Node.js is not installed")
def test_the_learning_rules_pass_their_node_tests():
    result = subprocess.run([NODE, "--test", os.path.join(HERE, "gomat_core.test.js")], capture_output=True, text=True, timeout=180)
    assert result.returncode == 0, (result.stdout + result.stderr)[-3000:]
    assert "# fail 0" in result.stdout and "# pass" in result.stdout
