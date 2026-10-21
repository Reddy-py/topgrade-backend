with open('topgrade/src/components/student-management/StudentFormModal.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

s3 = '{/* STEP 3: SCHEDULE & PORTAL CREDENTIALS */}'
footer = '{/* Modal Footer Controls */}'
i1 = content.find(s3)
i2 = content.find(footer)

if i1 != -1 and i2 != -1:
    content = content[:i1] + content[i2:]
    print('Step 3 removed')
else:
    print('Markers not found')

content = content.replace('onClick={() => setFormStep((prev) => (prev - 1) as 1 | 2 | 3)}', 'onClick={() => setFormStep(1)}')
content = content.replace('{formStep < 3 && (', '{formStep < 2 && (')
content = content.replace('{modalMode === "EDIT" && formStep === 3 && (', '{modalMode === "EDIT" && formStep === 2 && (')
content = content.replace('{modalMode === "ADD" && formStep === 3 && (', '{modalMode === "ADD" && formStep === 2 && (')

with open('topgrade/src/components/student-management/StudentFormModal.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
print('Done')
