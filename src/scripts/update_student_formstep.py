with open('topgrade/src/components/StudentManagement.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace(
    'const [formStep, setFormStep] = useState<1 | 2 | 3>(1);',
    'const [formStep, setFormStep] = useState<1 | 2>(1);'
)

content = content.replace(
    'setFormStep(prev => (prev < 3 ? (prev + 1) as 1 | 2 | 3 : 3));',
    'setFormStep(prev => (prev < 2 ? (prev + 1) as 1 | 2 : 2));'
)

content = content.replace(
    'const handleTabClick = (targetStep: 1 | 2 | 3) => {',
    'const handleTabClick = (targetStep: 1 | 2) => {'
)

content = content.replace(
    'if (formStep < 3) {\n      handleNextStep();\n      return;\n    }',
    'if (formStep < 2) {\n      handleNextStep();\n      return;\n    }'
)

with open('topgrade/src/components/StudentManagement.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
print('StudentManagement formStep updated.')
