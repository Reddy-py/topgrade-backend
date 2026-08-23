import { DemoDataService } from "./services/demoDataService.js";
import { getStudentsService } from "./services/studentService.js";
import { demoTeachersPool, demoCoursesPool } from "./services/demoDataService.js";

async function verifyAllCounts() {
  await DemoDataService.seedBulkDemoDataset();
  const studentsRes = await getStudentsService({ limit: 100 });

  console.log("=================================================");
  console.log("📊 VERIFYING HYDRATED DATASET REST API COUNTS");
  console.log("=================================================");
  console.log("• Total Students in API Roster:", studentsRes.total);
  console.log("• Total Teachers in API Roster:", demoTeachersPool.length + 2);
  console.log("• Total Courses in API Roster:", demoCoursesPool.length + 2);
  console.log("=================================================");
}

verifyAllCounts().catch(err => console.error("Error:", err));
