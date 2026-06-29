import time
from typing import Dict, Optional, Tuple

_balance_cache: Dict[int, Tuple[float, list]] = {}
_BALANCE_TTL = 30.0


def get_cached_balances(group_id: int) -> Optional[list]:
    entry = _balance_cache.get(group_id)
    if entry and entry[0] > time.monotonic():
        return entry[1]
    return None


def set_cached_balances(group_id: int, data: list):
    _balance_cache[group_id] = (time.monotonic() + _BALANCE_TTL, data)


def invalidate_balance(group_id: Optional[int]):
    if group_id:
        _balance_cache.pop(group_id, None)
