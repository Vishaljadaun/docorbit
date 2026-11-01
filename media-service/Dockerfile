FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /srv
COPY media-service/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY media-service/main.py ./main.py
COPY media-service/gallery_support.py ./gallery_support.py
COPY media-service/cobalt_alternative.py ./cobalt_alternative.py
COPY media-service/photo_direct.py ./photo_direct.py
CMD ["sh", "-c", "exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-10000}"]
