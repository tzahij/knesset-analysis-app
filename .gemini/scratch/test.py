import docx
import re
import json

p = [para.text for para in docx.Document(r'data/committee-raw/10007418.docx').paragraphs]
matches = [text for text in p if re.search(r'<<.+?>>', text)]

with open('.gemini/scratch/test_docx.json', 'w', encoding='utf-8') as f:
    json.dump(matches, f, ensure_ascii=False, indent=2)
