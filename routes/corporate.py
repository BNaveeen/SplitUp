from datetime import datetime
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import User, Organisation, Department, ExpenseReport, Expense
from routes.deps import get_db, get_current_user_id
from schemas import (
    OrgCreate, OrgResponse, DeptCreate, DeptResponse,
    AssignCorporateRequest, ReportCreate, ReportUpdate,
    ReportReviewRequest, ReportResponse, ReportExpenseItem,
)

router = APIRouter()


def _require_admin(uid: int, db: Session) -> User:
    u = db.query(User).filter(User.id == uid, User.is_admin == True).first()
    if not u:
        raise HTTPException(status_code=403, detail="Admin only")
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
    db.commit()
    return {
        "user_id": user_id,
        "organisation_id": user.organisation_id,
        "department_id": user.department_id,
        "manager_id": user.manager_id,
        "employee_id": user.employee_id,
    }


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
        "manager": {"id": mgr.id, "name": mgr.name, "email": mgr.email} if mgr else None,
        "employee_id": user.employee_id,
        "teammates": [{"id": t.id, "name": t.name, "email": t.email, "department_id": t.department_id} for t in teammates],
        "direct_reports": [{"id": r.id, "name": r.name, "email": r.email} for r in direct_reports],
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
    if report.status != "draft":
        raise HTTPException(status_code=400, detail="Only draft reports can be edited")
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
    report.status     = "submitted"
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
    if report.status != "draft":
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
    if report.status != "draft":
        raise HTTPException(status_code=400, detail="Cannot modify a submitted report")

    expense = db.query(Expense).filter(Expense.id == expense_id, Expense.report_id == report_id).first()
    if not expense:
        raise HTTPException(status_code=404, detail="Expense not in this report")

    expense.report_id   = None
    report.total_amount = sum(float(e.amount) for e in report.expenses if e.id != expense_id)
    report.updated_at   = datetime.utcnow()
    db.commit()
    return _fmt_report(report)


# ── Manager: Approvals ────────────────────────────────────────────────────────

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
