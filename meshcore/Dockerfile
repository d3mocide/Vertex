FROM python:3.12-slim

WORKDIR /app

RUN pip install --no-cache-dir pyserial-asyncio==0.6 websockets==13.1

COPY bridge.py .

EXPOSE 7001

CMD ["python", "-u", "bridge.py"]
