FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential curl \
    && rm -rf /var/lib/apt/lists/*

COPY services/indexer/requirements.txt /tmp/indexer-requirements.txt
RUN pip install --upgrade pip \
    && if [ -s /tmp/indexer-requirements.txt ]; then pip install --no-cache-dir -r /tmp/indexer-requirements.txt; fi

COPY . /app

CMD ["python", "-m", "graphrag_indexer.worker"]
