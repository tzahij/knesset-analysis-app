FROM python:3.13-slim-bookworm

WORKDIR /app

# Prevent Python from writing .pyc files and buffer stdout/stderr
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PORT=3001

COPY requirements.txt ./

RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN mkdir -p /app/data

EXPOSE 3001

# Default command runs the Flask server with gunicorn
CMD ["gunicorn", "--workers", "4", "--threads", "2", "--bind", "0.0.0.0:3001", "wsgi:app"]
