import express from "express";
import { runAutomatedEmailScan, sendBirthdayGreetings, sendExamGoodLuckWishes, sendCourseExamNotification, getBirthdayLogs } from "../services/automatedEmailService.js";
import { inMemoryStudentStore, saveStudentsToDisk } from "../services/studentService.js";
import { supabaseAdmin } from "../supabase.js";

const router = express.Router();

/**
 * POST /api/notifications/trigger-birthdays & /api/notifications/scan-birthdays
 * Force scan and send birthday emails for today based on DOB
 */
router.post(["/trigger-birthdays", "/scan-birthdays"], async (_req, res): Promise<any> => {
  try {
    const result = await runAutomatedEmailScan();
    return res.status(200).json({
      success: true,
      sentCount: result.birthdaysSent,
      birthdaysSent: result.birthdaysSent,
      examWishesSent: result.examWishesSent,
      message: `Birthday and exam email scan completed. ${result.birthdaysSent} birthday wishes sent today!`,
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
    const logs = getBirthdayLogs();
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
 * POST /api/notifications/trigger-exam-wishes
 * Force scan and send good luck emails for upcoming exams
 */
router.post("/trigger-exam-wishes", async (_req, res): Promise<any> => {
  try {
    const result = await runAutomatedEmailScan();
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
 * POST /api/notifications/send-exam-wish/:studentId
 * Send immediate good luck wish to specific student
 */
router.post("/send-exam-wish/:studentId", async (req, res): Promise<any> => {
  try {
    const { studentId } = req.params;
    const { examDate } = req.body || {};
    const student = inMemoryStudentStore.find(s => s.id === studentId || s.studentCode === studentId);
    if (!student) {
      return res.status(404).json({ success: false, error: "Student not found" });
    }

    const dateToUse = examDate || student.examDate || new Date().toISOString().split("T")[0];
    const ok = await sendExamGoodLuckWishes(student, dateToUse);
    return res.status(200).json({
      success: ok,
      message: ok ? `Exam good luck email sent to ${student.fullName} and parents.` : "Failed to send exam email."
    });
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
 * POST /api/notifications/send-birthday-wish/:studentId
 * Send immediate birthday greeting to specific student and parents from tglbiz101@gmail.com
 */
/**
 * POST /api/notifications/send-birthday-wish/:studentId
 * POST /api/notifications/send-birthday-wishes
 * POST /api/notifications/send-birthday-wish
 * Send immediate birthday greeting to student & parents from tglbiz101@gmail.com
 */
const sendBirthdayWishHandler = async (req: express.Request, res: express.Response): Promise<any> => {
  try {
    const studentId = req.params?.studentId || req.body?.studentId;
    const { studentName, studentEmail, parentEmail, dob } = req.body || {};
    let student = inMemoryStudentStore.find(s => (studentId && (s.id === studentId || s.studentCode === studentId)) || (studentEmail && s.email && s.email.toLowerCase() === studentEmail.toLowerCase()));

    if (!student && (studentEmail || studentName)) {
      student = {
        id: studentId || `stu-${Date.now()}`,
        studentCode: studentId || "TG-STU",
        fullName: studentName || "Student",
        email: studentEmail || "",
        studentEmails: studentEmail ? [studentEmail] : [],
        parentEmails: parentEmail ? [parentEmail] : [],
        dob: dob || "",
        school: "Top Grade Academy",
        status: "ACTIVE"
      };
    } else if (student) {
      if (studentEmail && !student.studentEmails?.includes(studentEmail)) {
        student.studentEmails = [...(student.studentEmails || []), studentEmail];
      }
      if (parentEmail && !student.parentEmails?.includes(parentEmail)) {
        student.parentEmails = [...(student.parentEmails || []), parentEmail];
      }
      if (dob) student.dob = dob;
    }

    if (!student || (!student.email && (!student.studentEmails || student.studentEmails.length === 0))) {
      return res.status(400).json({ success: false, error: "Student email address is missing." });
    }

    const ok = await sendBirthdayGreetings(student);
    return res.status(200).json({
      success: ok,
      message: ok
        ? `🎂 Happy Birthday greeting sent to ${student.fullName} (${student.email}) from tglbiz101@gmail.com!`
        : "Failed to dispatch birthday email."
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

router.post("/send-birthday-wish/:studentId", sendBirthdayWishHandler);
router.post("/send-birthday-wish", sendBirthdayWishHandler);
router.post("/send-birthday-wishes", sendBirthdayWishHandler);

/**
 * POST /api/notifications/set-course-exam-date
 * Admin endpoint: Sets exam date for all students registered in a course,
 * and automatically sends exam notification emails to students & parents.
 */
router.post("/set-course-exam-date", async (req: express.Request, res: express.Response): Promise<any> => {
  try {
    const { courseName, examDate, sendEmail = true } = req.body || {};
    if (!courseName || !examDate) {
      return res.status(400).json({ success: false, error: "Course name and Exam Date are required." });
    }

    const cNameClean = courseName.trim().toLowerCase();

    // 1. Find all matching students in memory
    const matchedStudents = inMemoryStudentStore.filter(s => {
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
          if (prog === cNameClean || prog.includes(cNameClean)) {
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
          const ok = await sendCourseExamNotification(student, examDate, courseName);
          if (ok) emailsSent++;
        } catch (e) {
          console.warn(`Failed sending exam notice to ${student.fullName}:`, e);
        }
      }
    }

    return res.status(200).json({
      success: true,
      studentsCount: matchedStudents.length,
      emailsSent,
      message: `Exam date '${examDate}' set for ${matchedStudents.length} students enrolled in '${courseName}'. ${emailsSent} notification emails dispatched from tglbiz101@gmail.com!`
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
