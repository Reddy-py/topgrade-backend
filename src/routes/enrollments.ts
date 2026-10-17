import { Router } from "express";
import { EnrollmentService, type EnrollmentStage } from "../services/enrollmentService.js";
import { LedgerService } from "../services/ledgerService.js";
import { supabaseAdmin } from "../supabase.js";

const router = Router();

function mapEnrollmentRow(row: any): any {
  return {
    id: row.id,
    leadId: row.lead_id || null,
    studentName: row.student_name,
    email: row.email,
    primaryMobile: row.primary_mobile,
    dob: row.dob,
    calculatedAge: row.calculated_age,
    residentialAddress: row.residential_address,
    academicGrade: row.academic_grade,
    status: row.status as EnrollmentStage,
    financialWaiver: Boolean(row.financial_waiver),
    transportWaiver: Boolean(row.transport_waiver),
    mediaWaiver: Boolean(row.media_waiver),
    reviewNotes: row.review_notes || undefined,
    submittedAt: row.submitted_at,
    reviewedAt: row.reviewed_at || undefined,
    approvedAt: row.approved_at || undefined,
    activatedAt: row.activated_at || undefined
  };
}

// 1. Submit New Enrollment
router.post("/", async (req, res) => {
  try {
    const { studentName, email, primaryMobile, dob, residentialAddress, academicGrade, leadId, financialWaiver, transportWaiver, mediaWaiver } = req.body;

    if (!studentName || !email || !primaryMobile || !dob || !residentialAddress || !academicGrade) {
      return res.status(400).json({
        success: false,
        message: "Missing mandatory enrollment fields (studentName, email, primaryMobile, dob, residentialAddress, academicGrade)."
      });
    }

    const calculatedAge = EnrollmentService.calculateDynamicAge(dob);
    const newId = `enr-${Date.now()}`;
    const nowIso = new Date().toISOString();

    const insertPayload = {
      id: newId,
      lead_id: leadId || null,
      student_name: studentName,
      email,
      primary_mobile: primaryMobile,
      dob,
      calculated_age: calculatedAge,
      residential_address: residentialAddress,
      academic_grade: academicGrade,
      status: "FORM_SUBMITTED",
      financial_waiver: Boolean(financialWaiver),
      transport_waiver: Boolean(transportWaiver),
      media_waiver: Boolean(mediaWaiver),
      submitted_at: nowIso
    };

    const { data: inserted, error } = await supabaseAdmin
      .from("enrollments")
      .insert(insertPayload)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to save enrollment to Supabase: ${error.message}`);
    }

    const mapped = mapEnrollmentRow(inserted);

    res.status(201).json({
      success: true,
      message: "Enrollment application submitted successfully!",
      data: mapped
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 2. List Enrollments
router.get("/", async (req, res) => {
  try {
    const { status } = req.query;
    let query = supabaseAdmin.from("enrollments").select("*").order("submitted_at", { ascending: false });

    if (status) {
      query = query.eq("status", String(status).toUpperCase());
    }

    const { data, error } = await query;
    if (error) {
      console.warn("Could not list enrollments:", error.message);
      return res.json({ success: true, count: 0, data: [] });
    }

    const mapped = (data || []).map(mapEnrollmentRow);

    res.json({
      success: true,
      count: mapped.length,
      data: mapped
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 3. Transition State (Review/Approve)
router.patch("/:id/review", async (req, res) => {
  try {
    const { id } = req.params;
    const { nextStatus, reviewNotes } = req.body;

    const { data: enrollment, error: fetchErr } = await supabaseAdmin
      .from("enrollments")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (fetchErr || !enrollment) {
      return res.status(404).json({ success: false, message: "Enrollment record not found." });
    }

    const transitionResult = EnrollmentService.transitionStage(enrollment.status, nextStatus);
    if (!transitionResult.valid) {
      return res.status(400).json({ success: false, message: transitionResult.message });
    }

    const updatePayload: Record<string, any> = {
      status: nextStatus,
      review_notes: reviewNotes || enrollment.review_notes
    };
    if (nextStatus === "UNDER_REVIEW") updatePayload.reviewed_at = new Date().toISOString();
    if (nextStatus === "APPROVED") updatePayload.approved_at = new Date().toISOString();

    const { data: updated, error: updateErr } = await supabaseAdmin
      .from("enrollments")
      .update(updatePayload)
      .eq("id", id)
      .select()
      .single();

    if (updateErr) {
      throw new Error(`Failed to update enrollment: ${updateErr.message}`);
    }

    res.json({
      success: true,
      message: transitionResult.message,
      data: mapEnrollmentRow(updated)
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 4. Activate Student & Generate Initial Invoice
router.post("/:id/activate", async (req, res) => {
  try {
    const { id } = req.params;
    const { data: enrollment, error: fetchErr } = await supabaseAdmin
      .from("enrollments")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (fetchErr || !enrollment) {
      return res.status(404).json({ success: false, message: "Enrollment record not found." });
    }

    if (enrollment.status !== "APPROVED" && enrollment.status !== "ACTIVATED") {
      return res.status(400).json({
        success: false,
        message: `Cannot activate student from state '${enrollment.status}'. Enrollment must be APPROVED first.`
      });
    }

    const nowIso = new Date().toISOString();
    const { data: activated, error: updateErr } = await supabaseAdmin
      .from("enrollments")
      .update({
        status: "ACTIVATED",
        activated_at: nowIso
      })
      .eq("id", id)
      .select()
      .single();

    if (updateErr) {
      throw new Error(`Failed to activate enrollment: ${updateErr.message}`);
    }

    const studentCode = EnrollmentService.generateStudentCode();
    const calculatedAge = EnrollmentService.calculateDynamicAge(activated.dob);

    // Initial Tuition Invoice
    const invoiceResult = LedgerService.createInvoice({
      studentId: studentCode,
      studentName: activated.student_name,
      grossAmount: 350.0,
      discountAmount: 50.0,
      dueDate: new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString().slice(0, 10)
    });

    res.json({
      success: true,
      message: `Student '${activated.student_name}' activated successfully with Code ${studentCode}!`,
      data: {
        student: {
          studentCode,
          fullName: activated.student_name,
          email: activated.email,
          dob: activated.dob,
          calculatedAge,
          status: "ACTIVE",
          residentialAddress: activated.residential_address
        },
        initialInvoice: invoiceResult.invoice,
        ledgerDebit: invoiceResult.debitEntry
      }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// STUDENT COURSE ENROLLMENTS (TASK 3: PACKAGE & HOURS PLANS WITH QUOTES)
// ─────────────────────────────────────────────────────────────────────────────
import { quoteEnrollment, type EnrollmentPlan } from "../services/pricing.js";
import { runDailyPackageExpiryJob } from "../services/enrollmentExpiryService.js";
import { ScheduleDataService } from "../services/scheduleDataService.js";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import { getAccessScope, allowsStudent } from "../services/accessScope.js";

// 5. Quote an Enrollment Plan (Pure calculation display, no payment taken)
router.post("/quote", async (req, res): Promise<any> => {
  try {
    const { course_id, course, plan, hours, starts_on } = req.body || {};
    let courseInfo = course;

    if (!courseInfo && course_id) {
      const { data: cData } = await supabaseAdmin
        .from("courses")
        .select("id, name, duration, duration_months, package_hours, package_price, hourly_rate")
        .or(`id.eq.${course_id},course_code.eq.${course_id}`)
        .maybeSingle();

      if (cData) {
        courseInfo = {
          id: cData.id,
          name: cData.name,
          package_price: cData.package_price !== null && cData.package_price !== undefined ? Number(cData.package_price) : null,
          package_hours: cData.package_hours !== null && cData.package_hours !== undefined ? Number(cData.package_hours) : null,
          hourly_rate: cData.hourly_rate !== null && cData.hourly_rate !== undefined ? Number(cData.hourly_rate) : null,
          duration_months: cData.duration_months !== null && cData.duration_months !== undefined ? Number(cData.duration_months) : null
        };
      }
    }

    if (!courseInfo) {
      return res.status(404).json({ success: false, message: "Course not found to calculate quote." });
    }

    const quote = quoteEnrollment(courseInfo, (plan || "PACKAGE") as EnrollmentPlan, hours, starts_on);
    return res.status(200).json({ success: true, data: quote });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// 6. Create Student Enrollment when Admin maps student to course
router.post("/create-enrollment", async (req, res): Promise<any> => {
  try {
    const authUser = (req as AuthenticatedRequest).user!;
    if (authUser.role !== "ADMIN") {
      return res.status(403).json({ success: false, message: "Only administrators can enroll students into courses." });
    }

    const { student_id, course_id, plan, hours, starts_on } = req.body || {};
    if (!student_id || !course_id) {
      return res.status(400).json({ success: false, message: "student_id and course_id are required." });
    }

    // 1. Fetch Student
    const { data: student, error: stErr } = await supabaseAdmin
      .from("students")
      .select("id, name, student_id_code, program, allocated_courses, email")
      .eq("id", student_id)
      .maybeSingle();

    if (stErr || !student) {
      return res.status(404).json({ success: false, message: "Student record not found." });
    }

    // 2. Fetch Course
      const { data: courseRow, error: cErr } = await supabaseAdmin
        .from("courses")
        .select("id, name, duration, duration_months, package_hours, package_price, hourly_rate")
        .eq("id", course_id)
        .maybeSingle();

      if (cErr || !courseRow) {
        return res.status(404).json({ success: false, message: "Course record not found." });
      }

      const courseObj = {
        id: courseRow.id,
        name: courseRow.name,
        package_price: courseRow.package_price !== null && courseRow.package_price !== undefined ? Number(courseRow.package_price) : null,
        package_hours: courseRow.package_hours !== null && courseRow.package_hours !== undefined ? Number(courseRow.package_hours) : null,
        hourly_rate: courseRow.hourly_rate !== null && courseRow.hourly_rate !== undefined ? Number(courseRow.hourly_rate) : null,
        duration_months: courseRow.duration_months !== null && courseRow.duration_months !== undefined ? Number(courseRow.duration_months) : null
      };

    // 3. Generate Quote
    const chosenPlan: EnrollmentPlan = (plan === "HOURS" ? "HOURS" : "PACKAGE");
    const quote = quoteEnrollment(courseObj, chosenPlan, hours, starts_on);

    if (!quote.is_valid) {
      return res.status(400).json({
        success: false,
        message: quote.error || "Cannot generate valid quote for this enrollment."
      });
    }

    // 4. Insert into student_enrollments table
    const { data: enrollment, error: insErr } = await supabaseAdmin
      .from("student_enrollments")
      .insert({
        student_id: student.id,
        course_id: courseRow.id,
        plan: quote.plan,
        hours_total: quote.hours_total,
        quoted_amount: quote.quoted_amount,
        currency: quote.currency,
        starts_on: quote.starts_on,
        expires_on: quote.expires_on,
        status: "ACTIVE"
      })
      .select()
      .single();

    if (insErr) {
      return res.status(500).json({ success: false, message: `Failed to save enrollment: ${insErr.message}` });
    }

    // 5. Update student's program and allocated_courses
    let existingAllocations: any[] = [];
    if (Array.isArray(student.allocated_courses)) {
      existingAllocations = [...student.allocated_courses];
    }
    const alreadyAllocated = existingAllocations.some((ac: any) =>
      (ac.courseName || "").trim().toLowerCase() === courseRow.name.trim().toLowerCase()
    );

    if (!alreadyAllocated) {
      existingAllocations.push({
        courseName: courseRow.name,
        duration: courseRow.duration || `${courseObj.duration_months} Months`,
        plan: quote.plan,
        hours: quote.hours_total
      });
      await supabaseAdmin
        .from("students")
        .update({
          program: student.program || courseRow.name,
          allocated_courses: existingAllocations,
          updated_at: new Date().toISOString()
        })
        .eq("id", student.id);
    }

    // 6. Record to student_history
    await ScheduleDataService.appendHistoryItem({
      student_id: student.id,
      student_name: student.name,
      event_type: "ENROLLMENT",
      title: `Enrolled in Course: ${courseRow.name} (${quote.plan})`,
      description: `Student enrolled in '${courseRow.name}' under ${quote.plan} plan with ${quote.hours_total} hours. Quoted amount: $${quote.quoted_amount.toFixed(2)}${quote.expires_on ? ` (Valid until ${quote.expires_on})` : " (No expiration)"}. Display only, no payment taken.`,
      metadata: {
        enrollment_id: enrollment.id,
        course_id: courseRow.id,
        course_name: courseRow.name,
        plan: quote.plan,
        hours_total: quote.hours_total,
        quoted_amount: quote.quoted_amount,
        currency: quote.currency,
        starts_on: quote.starts_on,
        expires_on: quote.expires_on
      },
      actor: (authUser.metadata as any)?.full_name || authUser.email || "Administrator"
    });

    return res.status(201).json({
      success: true,
      message: `Enrolled ${student.name} into '${courseRow.name}' (${quote.plan} plan, ${quote.hours_total} hours). Quoted amount: $${quote.quoted_amount.toFixed(2)}. Display only, no payment taken.`,
      data: enrollment,
      quote
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// 7. Get Enrollments for a specific Student (RLS backed / scoped)
router.get("/student/:studentId", async (req, res): Promise<any> => {
  try {
    const authUser = (req as AuthenticatedRequest).user!;
    const scope = await getAccessScope(authUser);
    const { studentId } = req.params;

    if (!allowsStudent(scope, studentId)) {
      return res.status(403).json({ success: false, message: "Forbidden: You are not authorized to view this student's enrollments." });
    }

    const { data: enrollments, error } = await supabaseAdmin
      .from("student_enrollments")
      .select(`
        id,
        student_id,
        course_id,
        plan,
        hours_total,
        quoted_amount,
        currency,
        starts_on,
        expires_on,
        status,
        created_at
      `)
      .eq("student_id", studentId)
      .order("created_at", { ascending: false });

    if (error) {
      return res.status(500).json({ success: false, message: error.message });
    }

    // Attach course names
    const courseIds = [...new Set((enrollments || []).map(e => e.course_id))];
    const { data: courses } = await supabaseAdmin
      .from("courses")
      .select("id, name, course_code")
      .in("id", courseIds);

    const cMap = new Map((courses || []).map(c => [c.id, c]));

    const mapped = (enrollments || []).map(e => ({
      ...e,
      course_name: cMap.get(e.course_id)?.name || "Course",
      course_code: cMap.get(e.course_id)?.course_code || ""
    }));

    return res.status(200).json({ success: true, count: mapped.length, data: mapped });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// 8. Admin Endpoint to Trigger Daily Expiry Job Manually or via Cron
router.post("/run-expiry-job", async (req, res): Promise<any> => {
  try {
    const authUser = (req as AuthenticatedRequest).user!;
    if (authUser.role !== "ADMIN") {
      return res.status(403).json({ success: false, message: "Only administrators can trigger the package expiry job." });
    }

    const result = await runDailyPackageExpiryJob("admin-manual-trigger");
    return res.status(200).json({ success: true, data: result });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// 9. End, Expire, or Cancel Enrollment (Moves student to past automatically if no active enrollments remain)
router.all(["/:id/status", "/:id/cancel", "/:id/end"], async (req: any, res: any): Promise<any> => {
  try {
    const authUser = (req as AuthenticatedRequest).user;
    if (!authUser || authUser.role !== "ADMIN") {
      return res.status(403).json({ success: false, message: "Only administrators can update enrollment status." });
    }

    const { id } = req.params;
    const requestedStatus = (req.body?.status || (req.path.includes("cancel") ? "CANCELLED" : "COMPLETED")).toUpperCase();
    const validStatuses = ["COMPLETED", "EXPIRED", "CANCELLED", "ACTIVE"];

    if (!validStatuses.includes(requestedStatus)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status '${requestedStatus}'. Must be one of: ${validStatuses.join(", ")}`
      });
    }

    const nowIso = new Date().toISOString();

    let studentId = "";
    let studentName = "";
    let courseName = "";
    let updatedEnrollment: any = { id, status: requestedStatus };

    // 1. Check if enrollment exists in student_enrollments
    try {
      const { data: enrollment, error: fetchErr } = await supabaseAdmin
        .from("student_enrollments")
        .select("*")
        .eq("id", id)
        .maybeSingle();

      if (!fetchErr && enrollment) {
        studentId = enrollment.student_id;
        studentName = enrollment.student_name || "Student";
        courseName = enrollment.course_id || "Course";

        const { data: upEnr } = await supabaseAdmin
          .from("student_enrollments")
          .update({ status: requestedStatus, updated_at: nowIso })
          .eq("id", id)
          .select()
          .maybeSingle();
        if (upEnr) updatedEnrollment = upEnr;
      }
    } catch {
      // Ignore if student_enrollments table doesn't exist
    }

    // 2. If studentId not found, check if id is a studentId in students or student_dossiers
    if (!studentId) {
      const { data: stu } = await supabaseAdmin
        .from("students")
        .select("id, name, status, program")
        .or(`id.eq.${id},student_id_code.eq.${id}`)
        .maybeSingle();

      if (stu) {
        studentId = stu.id;
        studentName = stu.name;
        courseName = stu.program || "Course";
      } else {
        const { data: dRow } = await supabaseAdmin
          .from("student_dossiers")
          .select("student_id, dossier")
          .eq("student_id", id)
          .maybeSingle();
        if (dRow) {
          studentId = dRow.student_id;
          studentName = dRow.dossier?.fullName || dRow.dossier?.name || "Student";
          courseName = dRow.dossier?.program || "Course";
        }
      }
    }

    if (!studentId) {
      return res.status(404).json({ success: false, message: `Enrollment or student '${id}' not found.` });
    }

    let studentMovedToPast = false;
    let newStudentStatus = "ACTIVE";

    // 3. If ending or cancelling (COMPLETED, EXPIRED, CANCELLED), move student to PAST
    if (["COMPLETED", "EXPIRED", "CANCELLED"].includes(requestedStatus)) {
      newStudentStatus = "PAST";
      studentMovedToPast = true;

      // Update students table
      await supabaseAdmin
        .from("students")
        .update({ status: "PAST" })
        .eq("id", studentId);

      // Update student_dossiers table
      const { data: dRow } = await supabaseAdmin
        .from("student_dossiers")
        .select("dossier")
        .eq("student_id", studentId)
        .maybeSingle();

      if (dRow?.dossier) {
        const updatedDossier = { ...dRow.dossier, status: "PAST", updatedAt: nowIso };
        if (Array.isArray(updatedDossier.allocatedCourses)) {
          updatedDossier.allocatedCourses = updatedDossier.allocatedCourses.map((c: any) => ({ ...c, status: requestedStatus }));
        }
        await supabaseAdmin
          .from("student_dossiers")
          .update({
            dossier: updatedDossier,
            updated_at: nowIso
          })
          .eq("student_id", studentId);
      }

      // Record who and when in student_history
      await ScheduleDataService.appendHistoryItem({
        student_id: studentId,
        student_name: studentName,
        event_type: "STATUS_CHANGE",
        title: "Student Moved to Past",
        description: `Enrollment course '${courseName}' ended with status '${requestedStatus}'. Student automatically moved to PAST.`,
        metadata: {
          enrollment_id: id,
          enrollment_status: requestedStatus,
          previous_student_status: "ACTIVE",
          new_student_status: "PAST",
          updated_by: authUser.email,
          timestamp: nowIso
        },
        actor: authUser.email || "System Administrator"
      });
    }

    // 4. Log the enrollment status change in student_history
    await ScheduleDataService.appendHistoryItem({
      student_id: studentId,
      student_name: studentName || "Student",
      event_type: "ENROLLMENT",
      title: `Enrollment Status Changed: ${requestedStatus}`,
      description: `Enrollment '${id}' for course '${courseName}' was updated to ${requestedStatus} by ${authUser.email}.`,
      metadata: {
        enrollment_id: id,
        status: requestedStatus,
        updated_by: authUser.email,
        student_moved_to_past: studentMovedToPast
      },
      actor: authUser.email || "System Administrator"
    });

    return res.status(200).json({
      success: true,
      message: `Enrollment status updated to ${requestedStatus}.${studentMovedToPast ? " Student has no active enrollments and was automatically moved to PAST." : ""}`,
      data: updatedEnrollment,
      studentMovedToPast,
      studentStatus: newStudentStatus
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

export default router;

