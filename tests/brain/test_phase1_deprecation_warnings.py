from __future__ import annotations

import importlib
import warnings

MODULES = [
    "brain.orchestrator",
    "brain.planner",
    "brain.dispatcher",
    "brain.router",
    "brain.loop",
    "brain.reflector",  # [V5.9-FIX-01] Added — reflector now has the pattern
]


def test_brain_compat_modules_emit_one_deprecation_warning() -> None:
    for module_name in MODULES:
        module = importlib.import_module(module_name)
        module._DEPRECATION_WARNED = False
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            module._warn_deprecated("phase1_test")
            module._warn_deprecated("phase1_test")

        dep_warnings = [w for w in caught if issubclass(w.category, DeprecationWarning)]
        assert len(dep_warnings) == 1, module_name
