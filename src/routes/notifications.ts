import express from "express";
import { studentContactEmails } from "../services/studentNotices.js";
import { runAutomatedEmailScan, sendBirthdayGreetings, sendExamGoodLuckWishes, sendCourseExamNotification, getBirthdayLogs } from "../services/automatedEmailService.js";
import { inMemoryStudentStore, saveStudentsToDisk, resolveStudent } from "../services/studentService.js";
import { supabaseAdmin } from "../supabase.js";
import {
  getStudentExamDatesService,
  upsertStudentExamDateService,
  sendSingleStudentExamWishService
} from "../services/examDateService.js";

const router = express.Router();

/**
 * POST /api/notifications/trigger-birthdays & /api/notifications/scan-birthdays
 * Force scan and send birthday emails for today based on DOB
 */
router.post(["/trigger-birthdays", "/scan-birthdays"], async (_req, res): Promise<any> => {
  try {
    const result = await runAutomatedEmailScan({ ignoreSendHour: true, forceAdminDigest: true });
    return res.status(200).json({
      success: true,
      sentCount: result.birthdaysSent,
      birthdaysSent: result.birthdaysSent,
      examWishesSent: result.examWishesSent,
      message: result.birthdaysSent > 0
        ? `Birthday scan complete! ${result.birthdaysSent} birthday wishes dispatched today.`
        : `Birthday scan complete: No birthdays today. Notification emailed to admin (tglbiz101@gmail.com).`,
      data: result
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/notifications/birthday-logs
 * Get historical logs of automated birthday and exam emails sent
 */
router.get("/birthday-logs", async (_req, res): Promise<any> => {
  try {
    const logs = await getBirthdayLogs();
    return res.status(200).json({
      success: true,
      count: logs.length,
      data: logs
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/notifications/send-birthday-wish/:studentId & /api/notifications/send-birthday-wish
 * Send immediate birthday greeting to a specific student
 */
router.post(["/send-birthday-wish/:studentId", "/send-birthday-wish"], async (req, res): Promise<any> => {
  try {
    const studentId = req.params.studentId || req.body?.studentId || req.body?.studentCode;
    const body = req.body || {};

    let student: any = inMemoryStudentStore.find(s => s.id === studentId || s.studentCode === studentId);
    if (!student && studentId) {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(studentId);
      const query = isUuid
        ? supabaseAdmin.from("students").select("*").eq("id", studentId).maybeSingle()
        : supabaseAdmin.from("students").select("*").ilike("student_id_code", studentId).maybeSingle();
      const { data: sbRow } = await query;
      if (sbRow) {
        student = {
          id: sbRow.id,
          studentCode: sbRow.student_id_code,
          fullName: sbRow.name || body.studentName || "Student",
          email: sbRow.email || body.studentEmail || "",
          studentEmails: sbRow.email ? [sbRow.email] : (body.studentEmail ? [body.studentEmail] : []),
          parentEmails: Array.isArray(sbRow.parent_emails) ? sbRow.parent_emails : (body.parentEmail ? [body.parentEmail] : []),
          school: sbRow.address?.split("School: ")?.[1] || "TopGrade",
          dob: sbRow.dob || body.dob || "",
          status: sbRow.status || "ACTIVE"
        };
      }
    }

    if (!student) {
      if (body.studentEmail || body.parentEmail) {
        student = {
          id: studentId || "manual",
          studentCode: studentId || "TG-MANUAL",
          fullName: body.studentName || "Student",
          email: body.studentEmail || "",
          studentEmails: body.studentEmail ? [body.studentEmail] : [],
          parentEmails: body.parentEmail ? [body.parentEmail] : [],
          school: "TopGrade",
          dob: body.dob || "",
          status: "ACTIVE"
        };
      } else {
        return res.status(404).json({ success: false, message: `Student '${studentId}' not found.` });
      }
    }

    const sent = await sendBirthdayGreetings(student, { force: true });
    return res.status(200).json({
      success: true,
      sent,
      message: sent
        ? `Birthday greeting email dispatched to ${student.fullName}!`
        : `Birthday greeting processed for ${student.fullName}.`
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/notifications/trigger-exam-wishes
 * Force scan and send good luck emails for upcoming exams
 */
router.post("/trigger-exam-wishes", async (_req, res): Promise<any> => {
  try {
    const result = await runAutomatedEmailScan({ ignoreSendHour: true });
    return res.status(200).json({
      success: true,
      message: `Exam good luck scan completed.`,
      data: result
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/notifications/student-exam-dates/:studentId
 * Retrieve all course exam dates for a specific student
 */
router.get("/student-exam-dates/:studentId", async (req, res): Promise<any> => {
  try {
    const { studentId } = req.params;
    const dates = await getStudentExamDatesService(studentId);
    return res.status(200).json({ success: true, data: dates });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/notifications/student-exam-dates
 * Set or update a student's course exam date (never overwrites other courses)
 */
router.post("/student-exam-dates", async (req, res): Promise<any> => {
  try {
    const { studentId, courseId, examDate, notes } = req.body || {};
    const record = await upsertStudentExamDateService({
      studentId,
      courseId,
      examDate,
      notes,
      createdBy: (req as any).user?.id,
    });
    return res.status(200).json({ success: true, data: record });
  } catch (err: any) {
    return res.status(400).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/notifications/send-1to1-exam-wish
 * Send personal 1-to-1 good luck wish with recipient selection and editable message
 */
router.post("/send-1to1-exam-wish", async (req, res): Promise<any> => {
  try {
    const { studentId, courseId, examDate, recipientTypes, customMessage, forceResend } = req.body || {};
    const result = await sendSingleStudentExamWishService({
      studentId,
      courseId,
      examDate,
      recipientTypes,
      customMessage,
      forceResend,
    });
    return res.status(200).json(result);
  } catch (err: any) {
    return res.status(400).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/notifications/send-exam-wish/:studentId
 * Send immediate good luck wish to specific student
 */
router.post("/send-exam-wish/:studentId", async (req, res): Promise<any> => {
  try {
    const { studentId } = req.params;
    const { examDate, courseId, recipientTypes, customMessage, forceResend } = req.body || {};
    const student = await resolveStudent(studentId);
    if (!student) {
      return res.status(404).json({ success: false, error: "Student not found" });
    }

    const result = await sendSingleStudentExamWishService({
      studentId: student.id || studentId,
      courseId,
      examDate: examDate || student.examDate,
      recipientTypes: recipientTypes || ["STUDENT", "PARENT"],
      customMessage,
      forceResend,
    });
    return res.status(200).json(result);
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/notifications/send-exam-wishes
 * Send immediate good luck wish to student and parent from tglbiz101@gmail.com
 */
router.post("/send-exam-wishes", async (req, res): Promise<any> => {
  try {
    const { studentId, studentName, studentEmail, parentEmail, examDate, courseName } = req.body || {};
    let student = inMemoryStudentStore.find(s => s.id === studentId || s.studentCode === studentId || (s.email && s.email.toLowerCase() === (studentEmail || "").toLowerCase()));
    
    if (!student && (studentEmail || studentName)) {
      student = {
        id: studentId || `stu-${Date.now()}`,
        studentCode: studentId || "TG-STU",
        fullName: studentName || "Student",
        email: studentEmail || "",
        studentEmails: studentEmail ? [studentEmail] : [],
        parentEmails: parentEmail ? [parentEmail] : [],
        program: courseName || "Academic Curriculum",
        examDate: examDate,
        dob: "",
        school: "Top Grade Academy",
        status: "ACTIVE"
      };
    } else if (student) {
      if (parentEmail && !student.parentEmails?.includes(parentEmail)) {
        student.parentEmails = [...(student.parentEmails || []), parentEmail];
      }
      if (examDate) student.examDate = examDate;
    }

    if (!student) {
      return res.status(400).json({ success: false, error: "Student information missing." });
    }

    const dateToUse = examDate || student.examDate || new Date().toISOString().split("T")[0];
    const ok = await sendExamGoodLuckWishes(student, dateToUse);
    return res.status(200).json({
      success: ok,
      message: ok ? `Exam good luck email sent to ${student.fullName} and parents from tglbiz101@gmail.com.` : "Failed to send exam email."
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
// Manual send-birthday-wish route removed per Task 15 Requirement 4. Automatic birthday sweep scan remains.

/**
 * POST /api/notifications/set-course-exam-date
 * Admin endpoint: Sets exam date for all students in a course OR customly for a single student,
 * and automatically sends official exam notification emails to students & parents.
 */
router.post("/set-course-exam-date", async (req: express.Request, res: express.Response): Promise<any> => {
  try {
    const { courseName, examDate, sendEmail = true, studentId, studentCode, studentEmail } = req.body || {};
    if (!examDate) {
      return res.status(400).json({ success: false, error: "Exam Date is required." });
    }

    // --- MODE A: SINGLE STUDENT CUSTOM SCHEDULE ---
    const targetLookup = studentId || studentCode;
    if (targetLookup || studentEmail) {
      let targetStudent: any = null;
      if (targetLookup) {
        targetStudent = inMemoryStudentStore.find(
          s => s.id === targetLookup || s.studentCode === targetLookup
        );
      }
      if (!targetStudent && studentEmail) {
        const cleanEmail = String(studentEmail).trim().toLowerCase();
        targetStudent = inMemoryStudentStore.find(
          s => (s.email && s.email.toLowerCase() === cleanEmail) ||
               (s.studentEmails || []).some(e => e.toLowerCase() === cleanEmail)
        );
      }

      // If not in memory store or email missing, check Supabase
      if (!targetStudent || (!targetStudent.email && targetLookup)) {
        const lookupKey = targetLookup || studentEmail;
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(lookupKey);
        const query = isUuid
          ? supabaseAdmin.from("students").select("*").eq("id", lookupKey).maybeSingle()
          : supabaseAdmin.from("students").select("*").or(`student_id_code.ilike.${lookupKey},email.ilike.${lookupKey}`).maybeSingle();
        const { data: sbRow } = await query;
        if (sbRow) {
          const fresh = {
            id: sbRow.id,
            studentCode: sbRow.student_id_code,
            fullName: sbRow.name || "Student",
            email: sbRow.email || "",
            studentEmails: sbRow.email ? [sbRow.email] : [],
            parentEmails: Array.isArray(sbRow.parent_emails) ? sbRow.parent_emails : [],
            school: sbRow.address?.split("School: ")?.[1] || "TopGrade",
            dob: sbRow.dob || "",
            program: sbRow.program || courseName || "Academic Curriculum",
            status: sbRow.status || "ACTIVE"
          };
          if (!targetStudent) targetStudent = fresh;
          else {
            if (!targetStudent.email && fresh.email) targetStudent.email = fresh.email;
            if ((!targetStudent.parentEmails || targetStudent.parentEmails.length === 0) && fresh.parentEmails.length > 0) {
              targetStudent.parentEmails = fresh.parentEmails;
            }
          }
        }
      }

      if (studentEmail && targetStudent && !targetStudent.email) {
        targetStudent.email = studentEmail;
      }

      if (!targetStudent) {
        return res.status(404).json({ success: false, error: `Student '${targetLookup || studentEmail}' not found.` });
      }

      // Update in-memory
      targetStudent.examDate = examDate;
      targetStudent.updatedAt = new Date().toISOString();
      saveStudentsToDisk();

      // Update in Supabase
      try {
        await supabaseAdmin
          .from("students")
          .update({
            medical_notes: `EXAM_DATE:${examDate}`,
            exam_date: examDate
          })
          .eq("id", targetStudent.id);
      } catch (sbErr: any) {
        try {
          await supabaseAdmin
            .from("students")
            .update({ medical_notes: `EXAM_DATE:${examDate}` })
            .eq("id", targetStudent.id);
        } catch {}
      }

      // Send official exam notice email
      let emailDispatched = false;
      const isSimulated = process.env.SIMULATE_EMAILS === "true";
      if (sendEmail) {
        const cName = courseName || targetStudent.program || "Academic Course";
        emailDispatched = await sendCourseExamNotification(targetStudent, examDate, cName);
      }

      const emailNote = emailDispatched
        ? isSimulated
          ? " Notification email logged in SIMULATION mode (set SIMULATE_EMAILS=false in server environment to deliver live emails)."
          : " Live notification email dispatched to student, parents & admin from tglbiz101@gmail.com! (Note: In Gmail, self-sent copies appear in the 'Sent' folder)."
        : "";

      return res.status(200).json({
        success: true,
        mode: "SINGLE_STUDENT",
        student: {
          id: targetStudent.id,
          name: targetStudent.fullName,
          studentCode: targetStudent.studentCode,
          examDate
        },
        studentsCount: 1,
        emailsSent: emailDispatched ? 1 : 0,
        simulated: isSimulated,
        message: `Official exam date '${examDate}' set for ${targetStudent.fullName}.${emailNote}`
      });
    }

    // --- MODE B: ENTIRE COURSE STREAM / ALL STUDENTS ---
    if (!courseName) {
      return res.status(400).json({ success: false, error: "Course name or specific Student is required." });
    }

    const cNameClean = courseName.trim().toLowerCase();
    const isAll = cNameClean === "all" || cNameClean === "all courses" || cNameClean === "all students";

    // 1. Find all matching students in memory
    const matchedStudents = inMemoryStudentStore.filter(s => {
      if ((s.status || "").toUpperCase() !== "ACTIVE") return false;
      if (isAll) return true;
      const matchProgram = (s.program || "").trim().toLowerCase() === cNameClean || (s.program || "").toLowerCase().includes(cNameClean);
      const matchAllocated = (s.allocatedCourses || []).some(
        c => (c.courseName || "").trim().toLowerCase() === cNameClean || (c.courseName || "").toLowerCase().includes(cNameClean)
      );
      return matchProgram || matchAllocated;
    });

    // Update their examDate
    matchedStudents.forEach(s => {
      s.examDate = examDate;
      s.updatedAt = new Date().toISOString();
    });

    if (matchedStudents.length > 0) {
      saveStudentsToDisk();
    }

    // 2. Also sync to live Supabase students
    try {
      const { data: sbStudents } = await supabaseAdmin.from("students").select("id, student_id_code, program, name, email");
      if (sbStudents && Array.isArray(sbStudents)) {
        for (const sbSt of sbStudents) {
          const prog = (sbSt.program || "").trim().toLowerCase();
          if (isAll || prog === cNameClean || prog.includes(cNameClean)) {
            await supabaseAdmin
              .from("students")
              .update({ medical_notes: `EXAM_DATE:${examDate}` })
              .eq("id", sbSt.id);
          }
        }
      }
    } catch (sbErr: any) {
      console.warn("Notice updating Supabase student exam dates:", sbErr.message);
    }

    // 3. Dispatch automatic Exam Notification emails if sendEmail is true
    let emailsSent = 0;
    if (sendEmail) {
      for (const student of matchedStudents) {
        try {
          const effectiveCourse = isAll ? (student.program || "Academic Course") : courseName;
          const ok = await sendCourseExamNotification(student, examDate, effectiveCourse);
          if (ok) emailsSent++;
        } catch (e) {
          console.warn(`Failed sending exam notice to ${student.fullName}:`, e);
        }
      }
    }

    return res.status(200).json({
      success: true,
      mode: "COURSE",
      studentsCount: matchedStudents.length,
      emailsSent,
      message: `Exam date '${examDate}' set for ${matchedStudents.length} students ${isAll ? "across all courses" : `enrolled in '${courseName}'`}. ${emailsSent} notification emails dispatched from tglbiz101@gmail.com!`
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/notifications/broadcast-course-exam-wishes
 * Admin endpoint: Sends Best of Luck wishes to all students enrolled in a course.
 */
router.post("/broadcast-course-exam-wishes", async (req: express.Request, res: express.Response): Promise<any> => {
  try {
    const { courseName, examDate } = req.body || {};
    if (!courseName) {
      return res.status(400).json({ success: false, error: "Course name is required." });
    }

    const cNameClean = courseName.trim().toLowerCase();
    const matchedStudents = inMemoryStudentStore.filter(s => {
      const matchProgram = (s.program || "").trim().toLowerCase() === cNameClean || (s.program || "").toLowerCase().includes(cNameClean);
      const matchAllocated = (s.allocatedCourses || []).some(
        c => (c.courseName || "").trim().toLowerCase() === cNameClean || (c.courseName || "").toLowerCase().includes(cNameClean)
      );
      return matchProgram || matchAllocated;
    });

    let wishesSent = 0;
    for (const student of matchedStudents) {
      try {
        const dateToUse = examDate || student.examDate || new Date().toISOString().split("T")[0];
        const ok = await sendExamGoodLuckWishes(student, dateToUse);
        if (ok) wishesSent++;
      } catch (e) {
        console.warn(`Failed sending exam wish to ${student.fullName}:`, e);
      }
    }

    return res.status(200).json({
      success: true,
      studentsCount: matchedStudents.length,
      wishesSent,
      message: `Good Luck exam wishes sent to ${wishesSent} students enrolled in '${courseName}' from tglbiz101@gmail.com!`
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
