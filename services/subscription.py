from sqlalchemy.orm import Session
from database import Subscription, FeatureFlag

PLANS = ['free', 'pro', 'business']

PLAN_PRICES = {'free': 0, 'pro': 4.99, 'business': 9.99}

# For limit features (max_*): limit_value=None means unlimited, positive means cap.
# For boolean features: enabled=True means available.
DEFAULT_FLAGS = {
    'free': {
        'max_groups':             {'enabled': True,  'limit': 3},
        'max_members_per_group':  {'enabled': True,  'limit': 5},
        'max_expenses_per_group': {'enabled': True,  'limit': 30},
        'realtime_updates':       {'enabled': False, 'limit': None},
        'csv_export':             {'enabled': False, 'limit': None},
        'pdf_export':             {'enabled': False, 'limit': None},
        'insights_basic':         {'enabled': False, 'limit': None},
        'insights_advanced':      {'enabled': False, 'limit': None},
        'expense_chat':           {'enabled': False, 'limit': None},
        'settle_all':             {'enabled': False, 'limit': None},
        'invite_link':            {'enabled': False, 'limit': None},
        'date_filter':            {'enabled': False, 'limit': None},
        'member_roles':           {'enabled': False, 'limit': None},
        'member_deactivate':      {'enabled': False, 'limit': None},
        'people_tab':             {'enabled': False, 'limit': None},
        'recurring_expenses':     {'enabled': False, 'limit': None},
        'group_budget':           {'enabled': False, 'limit': None},
    },
    'pro': {
        'max_groups':             {'enabled': False, 'limit': None},
        'max_members_per_group':  {'enabled': True,  'limit': 15},
        'max_expenses_per_group': {'enabled': False, 'limit': None},
        'realtime_updates':       {'enabled': True,  'limit': None},
        'csv_export':             {'enabled': True,  'limit': None},
        'pdf_export':             {'enabled': True,  'limit': None},
        'insights_basic':         {'enabled': True,  'limit': None},
        'insights_advanced':      {'enabled': False, 'limit': None},
        'expense_chat':           {'enabled': True,  'limit': None},
        'settle_all':             {'enabled': True,  'limit': None},
        'invite_link':            {'enabled': True,  'limit': None},
        'date_filter':            {'enabled': True,  'limit': None},
        'member_roles':           {'enabled': True,  'limit': None},
        'member_deactivate':      {'enabled': True,  'limit': None},
        'people_tab':             {'enabled': False, 'limit': None},
        'recurring_expenses':     {'enabled': True,  'limit': None},
        'group_budget':           {'enabled': True,  'limit': None},
    },
    'business': {
        'max_groups':             {'enabled': False, 'limit': None},
        'max_members_per_group':  {'enabled': False, 'limit': None},
        'max_expenses_per_group': {'enabled': False, 'limit': None},
        'realtime_updates':       {'enabled': True,  'limit': None},
        'csv_export':             {'enabled': True,  'limit': None},
        'pdf_export':             {'enabled': True,  'limit': None},
        'insights_basic':         {'enabled': True,  'limit': None},
        'insights_advanced':      {'enabled': True,  'limit': None},
        'expense_chat':           {'enabled': True,  'limit': None},
        'settle_all':             {'enabled': True,  'limit': None},
        'invite_link':            {'enabled': True,  'limit': None},
        'date_filter':            {'enabled': True,  'limit': None},
        'member_roles':           {'enabled': True,  'limit': None},
        'member_deactivate':      {'enabled': True,  'limit': None},
        'people_tab':             {'enabled': True,  'limit': None},
        'recurring_expenses':     {'enabled': True,  'limit': None},
        'group_budget':           {'enabled': True,  'limit': None},
    },
}


_FLAGS_VERSION = 2  # bump to force re-seed on next deploy

def seed_default_flags(db: Session):
    existing_count = db.query(FeatureFlag).count()
    expected_count = sum(len(v) for v in DEFAULT_FLAGS.values())
    # Re-seed if empty or stale (count mismatch means schema changed)
    if existing_count == expected_count:
        return
    # Wipe stale flags and re-seed
    db.query(FeatureFlag).delete()
    for plan, features in DEFAULT_FLAGS.items():
        for key, val in features.items():
            db.add(FeatureFlag(
                plan=plan, feature_key=key,
                enabled=val['enabled'], limit_value=val['limit'],
            ))
    db.commit()


def get_user_plan(db: Session, user_id: int) -> str:
    sub = db.query(Subscription).filter(
        Subscription.user_id == user_id,
        Subscription.is_active == True,
    ).first()
    return sub.plan if sub else 'free'


def _get_flag(db: Session, plan: str, feature_key: str):
    flag = db.query(FeatureFlag).filter(
        FeatureFlag.plan == plan,
        FeatureFlag.feature_key == feature_key,
    ).first()
    if flag:
        return bool(flag.enabled), flag.limit_value
    default = DEFAULT_FLAGS.get(plan, {}).get(feature_key, {})
    return bool(default.get('enabled', False)), default.get('limit', None)


def check_feature(db: Session, user_id: int, feature_key: str) -> bool:
    plan = get_user_plan(db, user_id)
    enabled, _ = _get_flag(db, plan, feature_key)
    return enabled


def get_limit(db: Session, user_id: int, limit_key: str):
    """Returns None/0 for unlimited, positive int for cap."""
    plan = get_user_plan(db, user_id)
    enabled, limit = _get_flag(db, plan, limit_key)
    if not enabled:
        return None
    return limit


def get_all_features(db: Session, user_id: int) -> dict:
    plan = get_user_plan(db, user_id)
    all_keys = sorted({k for v in DEFAULT_FLAGS.values() for k in v})
    features = {}
    for key in all_keys:
        enabled, limit = _get_flag(db, plan, key)
        if key.startswith('max_'):
            features[key] = limit if enabled else None
        else:
            features[key] = enabled
    sub = db.query(Subscription).filter(Subscription.user_id == user_id, Subscription.is_active == True).first()
    return {
        'plan': plan,
        'features': features,
        'expires_at': sub.expires_at.isoformat() if sub and sub.expires_at else None,
    }


def get_all_flags_by_plan(db: Session) -> dict:
    result = {}
    for plan in PLANS:
        flags = db.query(FeatureFlag).filter(FeatureFlag.plan == plan).all()
        if flags:
            result[plan] = {f.feature_key: {'enabled': bool(f.enabled), 'limit_value': f.limit_value} for f in flags}
        else:
            result[plan] = {k: {'enabled': v['enabled'], 'limit_value': v['limit']} for k, v in DEFAULT_FLAGS[plan].items()}
    return result


def _is_admin(db: Session, user_id: int) -> bool:
    from database import User
    user = db.query(User).filter(User.id == user_id).first()
    return bool(user and user.is_admin)


def require_feature(db: Session, user_id: int, feature_key: str, upgrade_to: str = 'pro'):
    """Raises HTTPException 403 with upgrade info if feature not available. Admins bypass."""
    from fastapi import HTTPException
    if _is_admin(db, user_id):
        return
    if not check_feature(db, user_id, feature_key):
        plan = get_user_plan(db, user_id)
        raise HTTPException(
            status_code=403,
            detail={
                "message": f"This feature requires a {upgrade_to.title()} plan.",
                "upgrade_to": upgrade_to,
                "feature": feature_key,
                "current_plan": plan,
            }
        )


def require_under_limit(db: Session, user_id: int, limit_key: str, current_count: int, upgrade_to: str = 'pro'):
    """Raises HTTPException 403 if current_count >= limit. Admins bypass."""
    from fastapi import HTTPException
    if _is_admin(db, user_id):
        return
    limit = get_limit(db, user_id, limit_key)
    if limit and limit > 0 and current_count >= limit:
        plan = get_user_plan(db, user_id)
        raise HTTPException(
            status_code=403,
            detail={
                "message": f"You've reached the {limit_key.replace('_', ' ')} limit ({limit}) on the {plan.title()} plan.",
                "upgrade_to": upgrade_to,
                "feature": limit_key,
                "current_plan": plan,
                "limit": limit,
            }
        )
