const { createClient } = require('@supabase/supabase-js');
const dns = require('dns');
const fs = require('fs');
dns.setDefaultResultOrder('ipv4first');

const supabase = createClient(
  'https://zznzmzwiewsnmykcbcni.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp6bnptendpZXdzbm15a2NiY25pIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MjQ4ODk0MSwiZXhwIjoyMDk4MDY0OTQxfQ.P8yhVbJhNoqq_ygIZh9KHlxEEJsBbj2wNAUUBJdvlsY'
);

async function exportCsv() {
  const { data: students, error } = await supabase.from('students').select('*').order('student_id_code', { ascending: true });
  if (error) {
    console.error(error);
    return;
  }
  const { data: { users } } = await supabase.auth.admin.listUsers({ perPage: 1000 });

  const headers = [
    'Sl No',
    'Student ID',
    'Student Name',
    'Student Login Email',
    'Student Default Password',
    'Student Phone',
    'Grade',
    'School',
    'Course / Program',
    'Assigned Teacher',
    'Parent Name',
    'Parent Login Email',
    'Parent Default Password',
    'Parent Phone'
  ];

  const rows = [headers.join(',')];

  students.forEach((s, idx) => {
    const code = s.student_id_code;
    const parentUser = users.find(u => {
      const m = u.user_metadata || {};
      if (m.role !== 'PARENT' && !u.email?.includes('parent')) return false;
      const codes = Array.isArray(m.child_codes) ? m.child_codes : (m.child_code ? m.child_code.split(',').map(c => c.trim()) : []);
      if (codes.includes(code)) return true;
      if (m.student_id_code && m.student_id_code.includes(code)) return true;
      if (m.student_code && m.student_code.includes(code)) return true;
      const numPart = code.replace('TG-STU-2026-', '').toLowerCase();
      if (u.email && u.email.includes(numPart)) return true;
      return false;
    });

    const parentEmail = parentUser ? parentUser.email : (s.father_name ? `parent.${s.father_name.toLowerCase().replace(/[^a-z0-9]/g, '.')}.${code.replace('TG-STU-2026-', '').toLowerCase()}@parents.topgrade.edu` : 'N/A');
    const parentName = s.father_name || s.mother_name || parentUser?.user_metadata?.full_name || 'Parent';
    const parentPhone = s.father_phone || parentUser?.user_metadata?.phone || s.phone || 'N/A';

    const row = [
      idx + 1,
      JSON.stringify(code),
      JSON.stringify(s.name || ''),
      JSON.stringify(s.email || ''),
      JSON.stringify('Student@TopGrade2026'),
      JSON.stringify(s.phone || 'N/A'),
      JSON.stringify(s.nationality || 'Grade 1-12'),
      JSON.stringify(s.address || 'TopGrade Partner School'),
      JSON.stringify(s.program || 'General Track'),
      JSON.stringify(s.teacher || 'Unassigned'),
      JSON.stringify(parentName),
      JSON.stringify(parentEmail),
      JSON.stringify('Parent@TopGrade2026'),
      JSON.stringify(parentPhone)
    ];
    rows.push(row.join(','));
  });

  const csvContent = rows.join('\n');
  fs.writeFileSync('student_and_parent_credentials.csv', csvContent, 'utf-8');
  console.log('Successfully wrote student_and_parent_credentials.csv with', students.length, 'students!');
}
exportCsv();
