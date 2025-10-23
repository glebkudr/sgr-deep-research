FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential curl \
    && rm -rf /var/lib/apt/lists/*

COPY services/api/requirements.txt /tmp/api-requirements.txt
RUN pip install --upgrade pip \
    && if [ -s /tmp/api-requirements.txt ]; then pip install --no-cache-dir -r /tmp/api-requirements.txt; fi

COPY . /app

CMD ["uvicorn", "graphrag_api.main:app", "--host", "0.0.0.0", "--port", "8000"]
