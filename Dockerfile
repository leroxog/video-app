# Satürn on an own server (Hetzner or any other): the same program that ran on Railway, in a container.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .
RUN useradd --create-home --uid 1000 satuern && mkdir -p /app/instance /app/static/uploads && chown -R satuern /app
USER satuern

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/', timeout=4).status < 500 else 1)"
CMD ["gunicorn", "app:app", "--bind", "0.0.0.0:8000", "--timeout", "300", "--workers", "1", "--threads", "8"]
