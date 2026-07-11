from datetime import datetime
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import User, Organisation, Department, ExpenseReport, Expense
from routes.deps import get_db, get_current_user_id, hash_password
from schemas import (
    OrgCreate, OrgResponse, DeptCreate, DeptResponse,
    AssignCorporateRequest, ReportCreate, ReportUpdate,
    ReportReviewRequest, ReportResponse, ReportExpenseItem,
    OrgMemberUpdate, OrgAddMemberRequest, OrgCreateMemberRequest,
    WorkExpenseItem,
)


router = APIRouter()


def _require_admin(uid: int, db: Session) -> User:
    u = db.query(User).filter(User.id == uid, User.is_admin == True).first()
    if not u:
        raise HTTPException(status_code=403, detail="Admin only")
    return u


def _require_org_admin(uid: int, db: Session) -> User:
    u = db.query(User).filter(User.id == uid).first()
    if not u or not u.organisation_id:
        raise HTTPException(status_code=403, detail="Not in an organisation")
    if u.org_role != "admin" and not u.is_admin:
        raise HTTPException(status_code=403, detail="Org admin access required")
    return u


def _fmt_report(r: ExpenseReport) -> dict:
    return {
        "id": r.id,
        "title": r.title,
        "description": r.description,
        "status": r.status,
        "currency": r.currency or "GBP",
        "total_amount": float(r.total_amount or 0),
        "period_start": r.period_start.isoformat() if r.period_start else None,
        "period_end": r.period_end.isoformat() if r.period_end else None,
        "created_at": r.created_at.isoformat(),
        "updated_at": r.updated_at.isoformat(),
        "submitted_by_name": r.submitted_by.name if r.submitted_by else "?",
        "organisation_name": r.organisation.name if r.organisation else "?",
        "department_name": r.department.name if r.department else None,
        "manager_name": r.manager.name if r.manager else None,
        "reviewed_by_name": r.reviewed_by.name if r.reviewed_by else None,
        "reviewed_at": r.reviewed_at.isoformat() if r.reviewed_at else None,
        "review_notes": r.review_notes,
        "expenses": [
            {
                "id": e.id,
                "description": e.description,
                "amount": float(e.amount),
                "currency": e.currency or "GBP",
                "category": e.category,
                "date": e.date.isoformat() if e.date else None,
                "receipt_image": e.receipt_image,
            }
            for e in (r.expenses or [])
        ],
    }


# ── Admin: Organisations ──────────────────────────────────────────────────────

@router.get("/admin/organisations")
def admin_list_orgs(
    uid: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    _require_admin(uid, db)
    orgs = db.query(Organisation).all()
    return [
        {
            "id": o.id,
            "name": o.name,
            "domain": o.domain,
            "member_count": db.query(User).filter(User.organisation_id == o.id).count(),
            "departments": [{"id": d.id, "name": d.name} for d in o.departments],
        }
        for o in orgs
    ]


@router.post("/admin/organisations", response_model=OrgResponse)
def admin_create_org(
    body: OrgCreate,
    uid: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    _require_admin(uid, db)
    org = Organisation(name=body.name.strip(), domain=body.domain)
    db.add(org); db.commit(); db.refresh(org)
    return org


@router.delete("/admin/organisations/{org_id}")
def admin_delete_org(
    org_id: int,
    uid: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    _require_admin(uid, db)
    org = db.query(Organisation).filter(Organisation.id == org_id).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organisation not found")
    # Unlink all members before deleting
    db.query(User).filter(User.organisation_id == org_id).update(
        {"organisation_id": None, "department_id": None, "manager_id": None},
        synchronize_session=False,
    )
    db.delete(org); db.commit()
    return {"message": "Organisation deleted"}


@router.post("/admin/organisations/{org_id}/departments", response_model=DeptResponse)
def admin_create_dept(
    org_id: int,
    body: DeptCreate,
    uid: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    _require_admin(uid, db)
    org = db.query(Organisation).filter(Organisation.id == org_id).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organisation not found")
    dept = Department(name=body.name.strip(), organisation_id=org_id)
    db.add(dept); db.commit(); db.refresh(dept)
    return dept


@router.delete("/admin/organisations/{org_id}/departments/{dept_id}")
def admin_delete_dept(
    org_id: int,
    dept_id: int,
    uid: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    _require_admin(uid, db)
    dept = db.query(Department).filter(Department.id == dept_id, Department.organisation_id == org_id).first()
    if not dept:
        raise HTTPException(status_code=404, detail="Department not found")
    db.query(User).filter(User.department_id == dept_id).update({"department_id": None}, synchronize_session=False)
    db.delete(dept); db.commit()
    return {"message": "Department deleted"}


@router.put("/admin/users/{user_id}/corporate")
def admin_assign_corporate(
    user_id: int,
    body: AssignCorporateRequest,
    uid: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    _require_admin(uid, db)
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.organisation_id = body.organisation_id
    user.department_id   = body.department_id
    user.manager_id      = body.manager_id
    user.employee_id     = body.employee_id
    if body.org_role is not None:
        user.org_role = body.org_role or None
    # Auto-set org_role to 'member' when assigning to an org
    if body.organisation_id and not user.org_role:
        user.org_role = "member"
    # Clear org_role when removing from org
    if body.organisation_id is None:
        user.org_role = None
    db.commit()
    return {
        "user_id": user_id,
        "organisation_id": user.organisation_id,
        "department_id": user.department_id,
        "manager_id": user.manager_id,
        "employee_id": user.employee_id,
        "org_role": user.org_role,
    }


# ── Org Admin: manage their own organisation ─────────────────────────────────

def _fmt_member(u: User, org: Organisation) -> dict:
    return {
        "id": u.id,
        "name": u.name,
        "email": u.email,
        "org_role": u.org_role or "member",
        "org_status": u.org_status or "active",
        "job_title": u.job_title,
        "department_id": u.department_id,
        "department_name": u.department.name if u.department else None,
        "manager_id": u.manager_id,
        "manager_name": u.manager.name if u.manager else None,
        "employee_id": u.employee_id,
    }


@router.get("/my/org/members")
def org_list_members(
    uid: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    admin = _require_org_admin(uid, db)
    members = db.query(User).filter(User.organisation_id == admin.organisation_id).all()
    org = db.query(Organisation).filter(Organisation.id == admin.organisation_id).first()
    return [_fmt_member(m, org) for m in members]


@router.get("/my/org/stats")
def org_stats(
    uid: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    admin = _require_org_admin(uid, db)
    oid = admin.organisation_id
    member_count  = db.query(User).filter(User.organisation_id == oid).count()
    report_counts = {}
    for status in ("draft", "submitted", "approved", "rejected", "reimbursed"):
        report_counts[status] = db.query(ExpenseReport).filter(
            ExpenseReport.organisation_id == oid,
            ExpenseReport.status == status,
        ).count()
    org = db.query(Organisation).filter(Organisation.id == oid).first()
    depts = db.query(Department).filter(Department.organisation_id == oid).all()
    return {
        "member_count": member_count,
        "report_counts": report_counts,
        "org_name": org.name if org else "?",
        "departments": [{"id": d.id, "name": d.name} for d in depts],
    }


@router.get("/my/org/all-reports")
def org_all_reports(
    uid: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    admin = _require_org_admin(uid, db)
    reports = db.query(ExpenseReport).filter(
        ExpenseReport.organisation_id == admin.organisation_id
    ).order_by(ExpenseReport.updated_at.desc()).all()
    return [_fmt_report(r) for r in reports]


@router.post("/my/org/reports/{report_id}/approve")
def org_approve_report(
    report_id: int,
    body: ReportReviewRequest,
    uid: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    admin = _require_org_admin(uid, db)
    report = db.query(ExpenseReport).filter(
        ExpenseReport.id == report_id,
        ExpenseReport.organisation_id == admin.organisation_id,
        ExpenseReport.status == "submitted",
    ).first()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found or not submitted")
    report.status         = "approved"
    report.reviewed_by_id = uid
    report.reviewed_at    = datetime.utcnow()
    report.review_notes   = body.notes
    report.updated_at     = datetime.utcnow()
    db.commit()
    return _fmt_report(report)


@router.post("/my/org/reports/{report_id}/reject")
def org_reject_report(
    report_id: int,
    body: ReportReviewRequest,
    uid: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    admin = _require_org_admin(uid, db)
    report = db.query(ExpenseReport).filter(
        ExpenseReport.id == report_id,
        ExpenseReport.organisation_id == admin.organisation_id,
        ExpenseReport.status == "submitted",
    ).first()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found or not submitted")
    report.status         = "rejected"
    report.reviewed_by_id = uid
    report.reviewed_at    = datetime.utcnow()
    report.review_notes   = body.notes
    report.updated_at     = datetime.utcnow()
    db.commit()
    return _fmt_report(report)


@router.post("/my/org/reports/{report_id}/reimburse")
def org_reimburse_report(
    report_id: int,
    uid: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    admin = _require_org_admin(uid, db)
    report = db.query(ExpenseReport).filter(
        ExpenseReport.id == report_id,
        ExpenseReport.organisation_id == admin.organisation_id,
        ExpenseReport.status == "approved",
    ).first()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found or not approved")
    report.status     = "reimbursed"
    report.updated_at = datetime.utcnow()
    db.commit()
    return _fmt_report(report)


@router.post("/my/org/members/add")
def org_add_existing_member(
    body: OrgAddMemberRequest,
    uid: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    admin = _require_org_admin(uid, db)
    user = db.query(User).filter(User.email == body.email.lower().strip()).first()
    if not user:
        raise HTTPException(status_code=404, detail="No account found with that email")
    if user.organisation_id and user.organisation_id != admin.organisation_id:
        raise HTTPException(status_code=400, detail="User already belongs to another organisation")
    user.organisation_id = admin.organisation_id
    user.department_id   = body.department_id
    user.manager_id      = body.manager_id
    user.org_role        = body.org_role or "member"
    if body.job_title is not None: user.job_title = body.job_title or None
    db.commit()
    org = db.query(Organisation).filter(Organisation.id == admin.organisation_id).first()
    return _fmt_member(user, org)


@router.post("/my/org/members/create")
def org_create_member(
    body: OrgCreateMemberRequest,
    uid: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    admin = _require_org_admin(uid, db)
    if db.query(User).filter(User.email == body.email.lower().strip()).first():
        raise HTTPException(status_code=400, detail="Email already registered")
    if len(body.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    user = User(
        name            = body.name.strip(),
        email           = body.email.lower().strip(),
        password        = hash_password(body.password),
        is_verified     = True,
        organisation_id = admin.organisation_id,
        department_id   = body.department_id,
        manager_id      = body.manager_id,
        org_role        = body.org_role or "member",
        job_title       = body.job_title or None,
    )
    db.add(user); db.commit(); db.refresh(user)
    org = db.query(Organisation).filter(Organisation.id == admin.organisation_id).first()
    return _fmt_member(user, org)


@router.put("/my/org/members/{user_id}")
def org_update_member(
    user_id: int,
    body: OrgMemberUpdate,
    uid: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    admin = _require_org_admin(uid, db)
    user = db.query(User).filter(
        User.id == user_id,
        User.organisation_id == admin.organisation_id,
    ).first()
    if not user:
        raise HTTPException(status_code=404, detail="Member not found in your organisation")
    if body.department_id is not None: user.department_id = body.department_id or None
    if body.manager_id    is not None: user.manager_id    = body.manager_id or None
    if body.org_role      is not None: user.org_role      = body.org_role or "member"
    if body.employee_id   is not None: user.employee_id   = body.employee_id or None
    if body.job_title     is not None: user.job_title     = body.job_title or None
    db.commit()
    org = db.query(Organisation).filter(Organisation.id == admin.organisation_id).first()
    return _fmt_member(user, org)


@router.delete("/my/org/members/{user_id}")
def org_remove_member(
    user_id: int,
    uid: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    admin = _require_org_admin(uid, db)
    if user_id == uid:
        raise HTTPException(status_code=400, detail="You cannot remove yourself")
    user = db.query(User).filter(
        User.id == user_id,
        User.organisation_id == admin.organisation_id,
    ).first()
    if not user:
        raise HTTPException(status_code=404, detail="Member not found in your organisation")
    user.organisation_id = None
    user.department_id   = None
    user.manager_id      = None
    user.org_role        = None
    db.commit()
    return {"message": f"{user.name} removed from organisation"}


@router.post("/my/org/departments")
def org_create_department(
    body: DeptCreate,
    uid: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    admin = _require_org_admin(uid, db)
    dept = Department(name=body.name.strip(), organisation_id=admin.organisation_id)
    db.add(dept); db.commit(); db.refresh(dept)
    return {"id": dept.id, "name": dept.name}


@router.delete("/my/org/departments/{dept_id}")
def org_delete_department(
    dept_id: int,
    uid: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    admin = _require_org_admin(uid, db)
    dept = db.query(Department).filter(
        Department.id == dept_id,
        Department.organisation_id == admin.organisation_id,
    ).first()
    if not dept:
        raise HTTPException(status_code=404, detail="Department not found")
    db.query(User).filter(User.department_id == dept_id).update({"department_id": None}, synchronize_session=False)
    db.delete(dept); db.commit()
    return {"message": "Department deleted"}


# ── My Organisation info ──────────────────────────────────────────────────────

@router.get("/my/org")
def get_my_org(
    uid: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    user = db.query(User).filter(User.id == uid).first()
    if not user or not user.organisation_id:
        raise HTTPException(status_code=404, detail="Not in an organisation")

    org  = db.query(Organisation).filter(Organisation.id == user.organisation_id).first()
    dept = db.query(Department).filter(Department.id == user.department_id).first() if user.department_id else None
    mgr  = db.query(User).filter(User.id == user.manager_id).first() if user.manager_id else None

    teammates = db.query(User).filter(
        User.organisation_id == user.organisation_id,
        User.id != uid,
    ).all()

    direct_reports = db.query(User).filter(User.manager_id == uid).all()

    return {
        "organisation": {"id": org.id, "name": org.name, "domain": org.domain},
        "department": {"id": dept.id, "name": dept.name} if dept else None,
        "manager": {"id": mgr.id, "name": mgr.name, "email": mgr.email, "job_title": mgr.job_title} if mgr else None,
        "employee_id": user.employee_id,
        "org_role": user.org_role or "member",
        "teammates": [
            {"id": t.id, "name": t.name, "email": t.email, "department_id": t.department_id,
             "manager_id": t.manager_id, "job_title": t.job_title}
            for t in teammates
        ],
        "direct_reports": [{"id": r.id, "name": r.name, "email": r.email, "job_title": r.job_title} for r in direct_reports],
    }


# ── Expense Reports ───────────────────────────────────────────────────────────

@router.get("/my/reports")
def list_my_reports(
    uid: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    user = db.query(User).filter(User.id == uid).first()
    if not user or not user.organisation_id:
        return []
    reports = db.query(ExpenseReport).filter(
        ExpenseReport.submitted_by_id == uid
    ).order_by(ExpenseReport.created_at.desc()).all()
    return [_fmt_report(r) for r in reports]


@router.post("/my/reports")
def create_report(
    body: ReportCreate,
    uid: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    user = db.query(User).filter(User.id == uid).first()
    if not user or not user.organisation_id:
        raise HTTPException(status_code=403, detail="You must be in an organisation to create expense reports")

    report = ExpenseReport(
        title           = body.title.strip(),
        description     = body.description,
        submitted_by_id = uid,
        organisation_id = user.organisation_id,
        department_id   = user.department_id,
        manager_id      = user.manager_id,
        currency        = body.currency or "GBP",
        status          = "draft",
        period_start    = datetime.fromisoformat(body.period_start) if body.period_start else None,
        period_end      = datetime.fromisoformat(body.period_end) if body.period_end else None,
    )
    db.add(report); db.commit(); db.refresh(report)
    return _fmt_report(report)


@router.get("/my/reports/{report_id}")
def get_report(
    report_id: int,
    uid: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    report = db.query(ExpenseReport).filter(ExpenseReport.id == report_id).first()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    if report.submitted_by_id != uid and report.manager_id != uid:
        raise HTTPException(status_code=403, detail="Access denied")
    return _fmt_report(report)


@router.put("/my/reports/{report_id}")
def update_report(
    report_id: int,
    body: ReportUpdate,
    uid: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    report = db.query(ExpenseReport).filter(
        ExpenseReport.id == report_id,
        ExpenseReport.submitted_by_id == uid,
    ).first()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    if report.status not in ("draft", "rejected"):
        raise HTTPException(status_code=400, detail="Only draft or rejected reports can be edited")
    if body.title is not None:      report.title       = body.title.strip()
    if body.description is not None: report.description = body.description
    if body.currency is not None:   report.currency    = body.currency
    if body.period_start is not None:
        report.period_start = datetime.fromisoformat(body.period_start) if body.period_start else None
    if body.period_end is not None:
        report.period_end = datetime.fromisoformat(body.period_end) if body.period_end else None
    report.updated_at = datetime.utcnow()
    db.commit()
    return _fmt_report(report)


@router.delete("/my/reports/{report_id}")
def delete_report(
    report_id: int,
    uid: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    report = db.query(ExpenseReport).filter(
        ExpenseReport.id == report_id,
        ExpenseReport.submitted_by_id == uid,
    ).first()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    if report.status not in ("draft", "rejected"):
        raise HTTPException(status_code=400, detail="Only draft or rejected reports can be deleted")
    # Unlink expenses from the report
    db.query(Expense).filter(Expense.report_id == report_id).update(
        {"report_id": None}, synchronize_session=False
    )
    db.delete(report); db.commit()
    return {"message": "Report deleted"}


@router.post("/my/reports/{report_id}/submit")
def submit_report(
    report_id: int,
    uid: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    report = db.query(ExpenseReport).filter(
        ExpenseReport.id == report_id,
        ExpenseReport.submitted_by_id == uid,
    ).first()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    if report.status != "draft":
        raise HTTPException(status_code=400, detail="Only draft reports can be submitted")
    if not report.expenses:
        raise HTTPException(status_code=400, detail="Add at least one expense before submitting")

    if report.status not in ("draft", "rejected"):
        raise HTTPException(status_code=400, detail="Only draft or rejected reports can be submitted")

    user = db.query(User).filter(User.id == uid).first()
    if report.manager_id:
        # Manager assigned — always requires approval regardless of role
        report.status         = "submitted"
        report.reviewed_by_id = None
        report.reviewed_at    = None
        report.review_notes   = None
    elif user and user.org_role == "admin":
        # Admin with no manager — self-approve
        report.status         = "approved"
        report.reviewed_by_id = uid
        report.reviewed_at    = datetime.utcnow()
        report.review_notes   = "Auto-approved: admin role, no manager assigned"
    else:
        # No manager, not admin — auto-approve
        report.status         = "approved"
        report.reviewed_by_id = uid
        report.reviewed_at    = datetime.utcnow()
        report.review_notes   = "Auto-approved: no manager assigned"

    report.updated_at = datetime.utcnow()
    db.commit()
    return _fmt_report(report)


@router.post("/my/reports/{report_id}/expenses/{expense_id}")
def add_expense_to_report(
    report_id: int,
    expense_id: int,
    uid: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    report = db.query(ExpenseReport).filter(
        ExpenseReport.id == report_id,
        ExpenseReport.submitted_by_id == uid,
    ).first()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    if report.status not in ("draft", "rejected"):
        raise HTTPException(status_code=400, detail="Cannot modify a submitted report")

    expense = db.query(Expense).filter(Expense.id == expense_id, Expense.payer_id == uid).first()
    if not expense:
        raise HTTPException(status_code=404, detail="Expense not found or not yours")

    expense.report_id = report_id
    # Recalculate total
    report.total_amount = sum(float(e.amount) for e in report.expenses) + float(expense.amount)
    report.updated_at   = datetime.utcnow()
    db.commit()
    return _fmt_report(report)


@router.delete("/my/reports/{report_id}/expenses/{expense_id}")
def remove_expense_from_report(
    report_id: int,
    expense_id: int,
    uid: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    report = db.query(ExpenseReport).filter(
        ExpenseReport.id == report_id,
        ExpenseReport.submitted_by_id == uid,
    ).first()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    if report.status not in ("draft", "rejected"):
        raise HTTPException(status_code=400, detail="Cannot modify a submitted report")

    expense = db.query(Expense).filter(Expense.id == expense_id, Expense.report_id == report_id).first()
    if not expense:
        raise HTTPException(status_code=404, detail="Expense not in this report")

    expense.report_id   = None
    report.total_amount = sum(float(e.amount) for e in report.expenses if e.id != expense_id)
    report.updated_at   = datetime.utcnow()
    db.commit()
    return _fmt_report(report)


# ── Expense Report inline items ───────────────────────────────────────────────

@router.post("/my/reports/{report_id}/items")
def add_report_item(
    report_id: int,
    body: WorkExpenseItem,
    uid: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    report = db.query(ExpenseReport).filter(
        ExpenseReport.id == report_id,
        ExpenseReport.submitted_by_id == uid,
    ).first()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    if report.status not in ("draft", "rejected"):
        raise HTTPException(status_code=400, detail="Cannot modify a submitted report")

    date_val = None
    if body.date:
        try:
            date_val = datetime.fromisoformat(body.date)
        except Exception:
            date_val = datetime.utcnow()
    else:
        date_val = datetime.utcnow()

    expense = Expense(
        description    = body.description.strip(),
        amount         = body.amount,
        payer_id       = uid,
        created_by_id  = uid,
        currency       = body.currency or report.currency or "GBP",
        category       = body.category,
        date           = date_val,
        report_id      = report_id,
        status         = "active",
    )
    db.add(expense)
    db.commit()
    db.refresh(report)
    report.total_amount = sum(float(e.amount) for e in report.expenses)
    report.updated_at   = datetime.utcnow()
    db.commit()
    db.refresh(report)
    return _fmt_report(report)


@router.delete("/my/reports/{report_id}/items/{expense_id}")
def delete_report_item(
    report_id: int,
    expense_id: int,
    uid: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    report = db.query(ExpenseReport).filter(
        ExpenseReport.id == report_id,
        ExpenseReport.submitted_by_id == uid,
    ).first()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    if report.status not in ("draft", "rejected"):
        raise HTTPException(status_code=400, detail="Cannot modify a submitted report")

    expense = db.query(Expense).filter(
        Expense.id == expense_id,
        Expense.report_id == report_id,
    ).first()
    if not expense:
        raise HTTPException(status_code=404, detail="Expense item not found in this report")

    db.delete(expense)
    db.flush()
    report.total_amount = sum(float(e.amount) for e in report.expenses if e.id != expense_id)
    report.updated_at   = datetime.utcnow()
    db.commit()
    return _fmt_report(report)


@router.put("/my/reports/{report_id}/items/{expense_id}")
def update_report_item(
    report_id: int,
    expense_id: int,
    body: WorkExpenseItem,
    uid: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    report = db.query(ExpenseReport).filter(
        ExpenseReport.id == report_id,
        ExpenseReport.submitted_by_id == uid,
    ).first()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    if report.status not in ("draft", "rejected"):
        raise HTTPException(status_code=400, detail="Cannot modify a submitted report")

    expense = db.query(Expense).filter(
        Expense.id == expense_id,
        Expense.report_id == report_id,
    ).first()
    if not expense:
        raise HTTPException(status_code=404, detail="Expense item not found in this report")

    expense.description = body.description.strip()
    expense.amount      = body.amount
    expense.category    = body.category
    expense.currency    = body.currency or report.currency or "GBP"
    if body.date:
        try:
            expense.date = datetime.fromisoformat(body.date)
        except Exception:
            pass
    if body.receipt_image is not None:
        expense.receipt_image = body.receipt_image or None

    db.commit()
    db.refresh(report)
    report.total_amount = sum(float(e.amount) for e in report.expenses)
    report.updated_at   = datetime.utcnow()
    db.commit()
    db.refresh(report)
    return _fmt_report(report)


# ── Manager: Approvals ──────────��─────────────────────────────��────────────────

@router.get("/my/approvals")
def list_pending_approvals(
    uid: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    reports = db.query(ExpenseReport).filter(
        ExpenseReport.manager_id == uid,
        ExpenseReport.status == "submitted",
    ).order_by(ExpenseReport.updated_at.desc()).all()
    return [_fmt_report(r) for r in reports]


@router.post("/my/approvals/{report_id}/approve")
def approve_report(
    report_id: int,
    body: ReportReviewRequest,
    uid: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    report = db.query(ExpenseReport).filter(
        ExpenseReport.id == report_id,
        ExpenseReport.manager_id == uid,
        ExpenseReport.status == "submitted",
    ).first()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found or not awaiting your approval")
    report.status        = "approved"
    report.reviewed_by_id = uid
    report.reviewed_at   = datetime.utcnow()
    report.review_notes  = body.notes
    report.updated_at    = datetime.utcnow()
    db.commit()
    return _fmt_report(report)


@router.post("/my/approvals/{report_id}/reject")
def reject_report(
    report_id: int,
    body: ReportReviewRequest,
    uid: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    report = db.query(ExpenseReport).filter(
        ExpenseReport.id == report_id,
        ExpenseReport.manager_id == uid,
        ExpenseReport.status == "submitted",
    ).first()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found or not awaiting your approval")
    report.status         = "rejected"
    report.reviewed_by_id = uid
    report.reviewed_at    = datetime.utcnow()
    report.review_notes   = body.notes
    report.updated_at     = datetime.utcnow()
    db.commit()
    return _fmt_report(report)


@router.post("/my/approvals/{report_id}/reimburse")
def reimburse_report(
    report_id: int,
    uid: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    report = db.query(ExpenseReport).filter(
        ExpenseReport.id == report_id,
        ExpenseReport.manager_id == uid,
        ExpenseReport.status == "approved",
    ).first()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found or not approved")
    report.status     = "reimbursed"
    report.updated_at = datetime.utcnow()
    db.commit()
    return _fmt_report(report)


# ── Employee activation / deactivation ────────────────────────────────────────

class OrgMemberStatusRequest(BaseModel):
    status: str  # 'active' | 'inactive'


@router.put("/my/org/members/{user_id}/status")
def org_set_member_status(
    user_id: int,
    body: OrgMemberStatusRequest,
    uid: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    admin = _require_org_admin(uid, db)
    if user_id == uid:
        raise HTTPException(status_code=400, detail="You cannot change your own status")
    if body.status not in ("active", "inactive"):
        raise HTTPException(status_code=400, detail="Status must be 'active' or 'inactive'")
    user = db.query(User).filter(
        User.id == user_id,
        User.organisation_id == admin.organisation_id,
    ).first()
    if not user:
        raise HTTPException(status_code=404, detail="Member not found in your organisation")
    user.org_status = body.status
    db.commit()
    org = db.query(Organisation).filter(Organisation.id == admin.organisation_id).first()
    return _fmt_member(user, org)


# ── Work trial claim (org-level, by org admin) ────────────────────────────────

@router.post("/my/org/claim-trial")
def org_claim_trial(
    uid: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    from database import AppSettings
    admin = _require_org_admin(uid, db)
    org = db.query(Organisation).filter(Organisation.id == admin.organisation_id).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organisation not found")
    if org.work_trial_claimed_at:
        raise HTTPException(status_code=400, detail="Trial already claimed for this organisation")
    settings = db.query(AppSettings).first()
    if not settings or not settings.work_trial_active:
        raise HTTPException(status_code=400, detail="Work trial offer is not currently available")
    org.work_trial_claimed_at = datetime.utcnow()
    db.commit()
    db.refresh(org)
    trial_days = settings.work_trial_days if settings else 14
    return {
        "message": "Work trial activated",
        "claimed_at": org.work_trial_claimed_at.isoformat(),
        "trial_days": trial_days,
        "expires_at": (org.work_trial_claimed_at.replace(
            day=org.work_trial_claimed_at.day
        )).isoformat(),
    }


# ── Personal trial claim ───────────────────────────────────────────────────────

@router.post("/users/{user_id}/claim-trial")
def user_claim_trial(
    user_id: int,
    uid: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    from database import AppSettings
    if uid != user_id:
        raise HTTPException(status_code=403, detail="Forbidden")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.trial_claimed_at:
        raise HTTPException(status_code=400, detail="Free trial already claimed")
    settings = db.query(AppSettings).first()
    if not settings or not settings.personal_trial_active:
        raise HTTPException(status_code=400, detail="Free trial offer is not currently available")
    user.trial_claimed_at = datetime.utcnow()
    # Upgrade to premium for the trial period
    from database import Subscription as SubscriptionModel
    from datetime import timedelta
    trial_days = settings.personal_trial_days
    expires = datetime.utcnow() + timedelta(days=trial_days)
    sub = db.query(SubscriptionModel).filter(SubscriptionModel.user_id == user_id).first()
    if sub:
        sub.plan = "business"
        sub.is_active = True
        sub.expires_at = expires
    else:
        sub = SubscriptionModel(user_id=user_id, plan="business", is_active=True, expires_at=expires)
        db.add(sub)
    db.commit()
    db.refresh(user)
    from schemas import UserResponse
    return {
        "user": UserResponse.model_validate(user),
        "trial_days": trial_days,
        "expires_at": expires.isoformat(),
    }
