import { attendanceStore, type ScanMethodEnum } from "./attendanceService.js";
import { studentCourseBalancesStore } from "./courseHoursService.js";

export interface DemoTeacherSeed {
  id: string;
  fullName: string;
  email: string;
  specialization: string;
  hourlyRate: number;
  bio: string;
  isDemoData: boolean;
}

export interface DemoCourseSeed {
  id: string;
  title: string;
  targetGrade: string;
  duration: string;
  baseFee: number;
  capacity: number;
  assignedTeacherId: string;
  assignedTeacherName: string;
  description: string;
  isDemoData: boolean;
}

export interface DemoStudentSeed {
  id: string;
  studentCode: string;
  fullName: string;
  email: string;
  grade: string;
  age: number;
  dob: string;
  fatherName: string;
  motherName: string;
  parentEmail: string;
  parentPhone: string;
  enrolledCourseId: string;
  enrolledCourseName: string;
  availableHours: number;
  isDemoData: boolean;
}

// In-Memory Storage Pools for Fast Execution & Fallback Integration
export let demoTeachersPool: DemoTeacherSeed[] = [];
export let demoCoursesPool: DemoCourseSeed[] = [];
export let demoStudentsPool: DemoStudentSeed[] = [];

// Seed Data Configuration Constants
const TEACHER_SPECIALIZATIONS = [
  { name: "Dr. Rajesh Verma", spec: "AP Physics C & Quantum Mechanics", rate: 85, bio: "Ph.D. in Applied Physics with 14+ years teaching AP Physics & IIT JEE prep." },
  { name: "Ananya Sengupta", spec: "Advanced Calculus BC & Linear Algebra", rate: 75, bio: "M.Sc Mathematics, specializing in calculus, statistics, and competitive math competitions." },
  { name: "David Miller", spec: "Robotics, Mechatronics & AI Engineering", rate: 80, bio: "Ex-Robotics Engineer with expertise in Arduino, Raspberry Pi, and Python AI algorithms." },
  { name: "Priya Nair", spec: "Organic Chemistry & Biochemistry", rate: 70, bio: "10+ years guiding pre-med and high school students through AP Chemistry and lab research." },
  { name: "Michael Brown", spec: "Full-Stack Python & Data Analytics", rate: 75, bio: "Senior Data Scientist teaching Python, SQL, web development, and cloud systems." },
  { name: "Sunita Sharma", spec: "Primary STEM & Elementary Foundation Math", rate: 50, bio: "Elementary education specialist focusing on interactive math puzzles and STEM projects." },
  { name: "James Wilson", spec: "English Literature, SAT & ACT Prep", rate: 65, bio: "Oxford graduate coaching SAT Verbal, critical writing, and college essay prep." },
  { name: "Kavita Reddy", spec: "Molecular Biology & Genetics", rate: 60, bio: "Biotech researcher teaching high school biology, genetics, and lab techniques." },
  { name: "Vikram Malhotra", spec: "Middle School General Science & Chemistry", rate: 55, bio: "Passionate educator simplifying physics, chemistry, and earth science for Grades 6-8." },
  { name: "Sarah Jenkins", spec: "Creative Coding & Scratch for Kids", rate: 45, bio: "STEM advocate empowering K-5 learners through Scratch block coding and game design." }
];

const COURSE_TITLES = [
  "Kindergarten Discovery STEM", "Grade 1 Math Foundations", "Grade 1 Phonics & Reading",
  "Grade 2 Young Explorers Science", "Grade 2 Math Olympiad Junior", "Grade 3 Scratch Game Development",
  "Grade 3 Creative Writing & Logic", "Grade 4 Elementary Robotics", "Grade 4 Advanced Arithmetic",
  "Grade 5 Environmental Science", "Grade 5 Python Coding for Kids", "Grade 5 Junior Math Challenge",
  "Grade 6 General Science Lab", "Grade 6 Pre-Algebra Masterclass", "Grade 6 World History & Essay Writing",
  "Grade 7 Physical Science & Circuits", "Grade 7 Algebra I Intensive", "Grade 7 Web Design Fundamentals",
  "Grade 8 Earth & Space Science", "Grade 8 Geometry & Proofs", "Grade 8 Python Algorithms",
  "Grade 9 Biology Honors", "Grade 9 Algebra II & Functions", "Grade 9 High School Literature",
  "Grade 10 Chemistry Honors", "Grade 10 Trigonometry & Pre-Calculus", "Grade 10 Digital Electronics",
  "Grade 11 AP Physics 1 (Algebra-Based)", "Grade 11 AP Chemistry", "Grade 11 SAT Boot Camp (Math & Verbal)",
  "Grade 12 AP Physics C (Calculus-Based)", "Grade 12 AP Calculus BC", "Grade 12 Organic Chemistry & Lab",
  "Grade 12 ACT Intensive Prep", "Grade 12 Data Structures & Algorithms",
  "Robotics & Autonomous Rovers Lab", "Artificial Intelligence & Machine Learning Fundamentals",
  "Cybersecurity & Network Security Track", "Competitive Math Olympiad (AMC 10/12 Prep)",
  "AP Computer Science A (Java)", "AP Environmental Science", "Microeconomics & Financial Literacy",
  "Macroeconomics & Public Policy", "Biotechnology & Genetic Engineering", "Mobile App Development with React Native",
  "Public Speaking & Debate Club", "Astronomy & Astrophysics Primer", "Creative Writing & Publishing Workshop",
  "Design Thinking & 3D Printing Lab", "Quantum Computing & Future Tech Lab"
];

const FIRST_NAMES = [
  "Aarav", "Diya", "Ishaan", "Kabir", "Anika", "Rohan", "Maya", "Ethan", "Tara", "Aditya",
  "Siddharth", "Riya", "Dev", "Meera", "Arjun", "Zara", "Karan", "Pari", "Vivaan", "Neha",
  "Yash", "Tanvi", "Nikhil", "Shreya", "Varun", "Pooja", "Ayaan", "Ira", "Reyansh", "Anvi",
  "Lucas", "Sophia", "Liam", "Olivia", "Noah", "Emma", "Oliver", "Ava", "Elijah", "Isabella",
  "James", "Mia", "Benjamin", "Charlotte", "Henry", "Amelia", "Alexander", "Harper", "Sebastian", "Evelyn"
];

const LAST_NAMES = [
  "Sharma", "Patel", "Kumar", "Singh", "Reddy", "Gupta", "Lin", "Thomas", "Nair", "Joshi",
  "Verma", "Sengupta", "Chowdhury", "Mehta", "Iyer", "Rao", "Deshmukh", "Kapoor", "Bhat", "Shah",
  "Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Rodriguez", "Martinez"
];

export class DemoDataService {
  public static async seedBulkDemoDataset() {
    this.purgeDemoDataset();

    // A. Seed 10 Faculty Members
    const teachers: DemoTeacherSeed[] = TEACHER_SPECIALIZATIONS.map((t, idx) => ({
      id: `tchr-demo-${idx + 1}`,
      fullName: t.name,
      email: `${t.name.toLowerCase().replace(/[^a-z]/g, "")}@topgrade.edu`,
      specialization: t.spec,
      hourlyRate: t.rate,
      bio: t.bio,
      isDemoData: true
    }));
    demoTeachersPool.push(...teachers);

    // B. Seed 50 Courses
    const courses: DemoCourseSeed[] = COURSE_TITLES.map((title, idx) => {
      const assignedTeacher = teachers[idx % teachers.length] || teachers[0]!;
      const gradeBracket = idx < 12 ? "Grade K-5" : idx < 24 ? "Grade 6-8" : idx < 36 ? "Grade 9-12" : "Advanced College Track";
      return {
        id: `crs-demo-${idx + 101}`,
        title,
        targetGrade: gradeBracket,
        duration: idx % 2 === 0 ? "3 Months" : "6 Months",
        baseFee: 300 + (idx * 15),
        capacity: 20,
        assignedTeacherId: assignedTeacher.id,
        assignedTeacherName: assignedTeacher.fullName,
        description: `Comprehensive academic curriculum for ${title}. Led by ${assignedTeacher.fullName}.`,
        isDemoData: true
      };
    });
    demoCoursesPool.push(...courses);

    // C. Seed 50 Students & Linked Parents
    const students: DemoStudentSeed[] = Array.from({ length: 50 }).map((_, idx) => {
      const fn = FIRST_NAMES[idx % FIRST_NAMES.length] || "Student";
      const ln = LAST_NAMES[idx % LAST_NAMES.length] || "User";
      const fullName = `${fn} ${ln}`;
      const codeNum = 9100 + idx;
      const studentCode = `TG-2026-${codeNum}`;
      const age = 6 + (idx % 12);
      const birthYear = 2026 - age;
      const dob = `${birthYear}-05-15`;
      const course = courses[idx % courses.length] || courses[0]!;

      return {
        id: `std-demo-${idx + 101}`,
        studentCode,
        fullName,
        email: `${fn.toLowerCase()}.${ln.toLowerCase()}@student.topgrade.edu`,
        grade: `Grade ${Math.min(12, Math.max(1, age - 5))}`,
        age,
        dob,
        fatherName: `Rajesh ${ln}`,
        motherName: `Sunita ${ln}`,
        parentEmail: `parent.${ln.toLowerCase()}@topgrade.edu`,
        parentPhone: `+1-555-01${(idx + 10).toString().padStart(2, '0')}`,
        enrolledCourseId: course.id,
        enrolledCourseName: course.title,
        availableHours: 20 + (idx % 15),
        isDemoData: true
      };
    });
    demoStudentsPool.push(...students);

    // D. Hydrate Student Course Balances & Initial Attendance Logs
    students.forEach((s, idx) => {
      studentCourseBalancesStore.push({
        id: `bal-demo-${s.id}`,
        studentId: s.id,
        studentName: s.fullName,
        courseId: s.enrolledCourseId,
        courseName: s.enrolledCourseName,
        pricingModel: "HOURLY_CREDIT_PACKAGE",
        totalPurchasedHours: s.availableHours + 10,
        availableHours: s.availableHours,
        usedHours: 10,
        status: "ACTIVE",
        quotaWarningTriggered: s.availableHours <= 2,
        teacherWarningMessage: s.availableHours <= 2 ? `⚠️ Quota Warning: Only ${s.availableHours} session(s) remaining!` : undefined,
        updatedAt: new Date().toISOString()
      });

      attendanceStore.push({
        id: `att-demo-${s.id}`,
        studentId: s.id,
        studentName: s.fullName,
        studentCode: s.studentCode,
        courseId: s.enrolledCourseId,
        courseName: s.enrolledCourseName,
        parentEmail: s.parentEmail,
        parentPhone: s.parentPhone,
        parentName: s.fatherName,
        checkInTime: new Date(Date.now() - (idx * 3600000)).toISOString(),
        status: idx % 5 === 0 ? "ABSENT" : "PRESENT",
        scanMethod: "STUDENT_SELF_QR" as ScanMethodEnum,
        date: new Date().toISOString().slice(0, 10),
        createdAt: new Date().toISOString()
      });
    });

    return {
      success: true,
      message: "Massive 50+ Demo Dataset seeded successfully!",
      stats: {
        teachersCount: demoTeachersPool.length,
        coursesCount: demoCoursesPool.length,
        studentsCount: demoStudentsPool.length,
        totalDemoRecords: demoTeachersPool.length + demoCoursesPool.length + demoStudentsPool.length
      }
    };
  }

  public static purgeDemoDataset() {
    const prevTeacherCount = demoTeachersPool.length;
    const prevCourseCount = demoCoursesPool.length;
    const prevStudentCount = demoStudentsPool.length;

    demoTeachersPool = [];
    demoCoursesPool = [];
    demoStudentsPool = [];

    for (let i = studentCourseBalancesStore.length - 1; i >= 0; i--) {
      if (studentCourseBalancesStore[i]?.studentId?.startsWith("std-demo-")) {
        studentCourseBalancesStore.splice(i, 1);
      }
    }

    for (let i = attendanceStore.length - 1; i >= 0; i--) {
      if (attendanceStore[i]?.studentId?.startsWith("std-demo-") || attendanceStore[i]?.id?.startsWith("att-demo-")) {
        attendanceStore.splice(i, 1);
      }
    }

    return {
      success: true,
      message: "1-Click Demo Data Purge executed successfully. Workspace restored to clean production state.",
      purgedStats: {
        teachersPurged: prevTeacherCount,
        coursesPurged: prevCourseCount,
        studentsPurged: prevStudentCount
      }
    };
  }

  public static getDemoDataStats() {
    return {
      demoTeachersCount: demoTeachersPool.length,
      demoCoursesCount: demoCoursesPool.length,
      demoStudentsCount: demoStudentsPool.length,
      isDemoDataActive: demoStudentsPool.length > 0
    };
  }
}
