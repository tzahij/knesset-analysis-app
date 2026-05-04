"""Shared file content extractor used by both API routes and the processor."""
import os
import logging

logger = logging.getLogger(__name__)


def extract_text(file_path: str) -> str:
    """
    Extract plain text from a .docx or .pdf file.
    Returns empty string if the file does not exist or extraction fails.
    """
    if not file_path or not os.path.exists(file_path):
        return ""

    ext = os.path.splitext(file_path)[1].lower().lstrip(".")
    try:
        if ext == "pdf":
            import pdfplumber
            with pdfplumber.open(file_path) as pdf:
                return "\n".join(page.extract_text() or "" for page in pdf.pages).strip()

        if ext in ("docx", "doc"):
            import docx
            doc = docx.Document(file_path)
            return "\n".join(p.text for p in doc.paragraphs).strip()

    except Exception as e:
        logger.error(f"extract_text failed for {file_path}: {e}")

    return ""
