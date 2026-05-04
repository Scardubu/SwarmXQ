# Integration instructions

Drop-in points only. No workflow reshaping is required.

1. Replace the updated agent markdown files in `agents/` and the skill markdown files in `skills/`.
2. Replace `skills/catalog.yaml` so the four utility skills are available to the selector.
3. Replace `src/swarmx/skills.py` so the default fallback library knows the same utility skills.
4. Replace `src/swarmx/planner.py` so the existing role tags can route to the new utility skills.
5. Replace the patched workflow YAML files in `workflows/` to keep the same stages while sharpening their internal criteria.
6. Reload the bundle or restart the runtime so the new catalog and prompt text are picked up.

Nothing else needs to change. The external interfaces, stage names, and workflow shapes remain intact.
