"""Attack stories. Each module has NAME, DESCRIPTION and generate(ds, world, start, end) -> answers."""
from . import identity_compromise

SCENARIOS = {m.NAME: m for m in (identity_compromise,)}
