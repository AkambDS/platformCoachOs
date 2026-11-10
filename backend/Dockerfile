# Exact Python version — matches requirements.lock (a floating tag can change on rebuild)
FROM --platform=linux/amd64 python:3.12.14-slim

# System deps for WeasyPrint (PDF), psycopg2, and general C libs
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libpq-dev \
    libpango-1.0-0 \
    libpangoft2-1.0-0 \
    libharfbuzz0b \
    libcairo2 \
    libgdk-pixbuf-2.0-0 \
    libffi-dev \
    fontconfig \
    fonts-liberation \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Upgrade pip + install build tools first
RUN pip install --no-cache-dir --upgrade pip setuptools wheel

# Install Python dependencies — requirements.lock pins every package (incl. sub-deps)
# to the tested versions, so a rebuild never pulls a surprise new release.
COPY requirements.txt requirements.lock ./
RUN pip install --no-cache-dir -r requirements.txt -c requirements.lock

COPY . .

# Make entrypoint executable
RUN chmod +x /app/entrypoint.sh

EXPOSE 8000

ENTRYPOINT ["/app/entrypoint.sh"]
CMD []