FROM node:22-slim

# Simulate a fresh developer machine — only Node.js + git
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

# Create a fake project
WORKDIR /app
RUN git init && git config user.email "test@test.com" && git config user.name "Test"
RUN npm init -y
RUN echo "console.log('hello');" > index.js
RUN git add -A && git commit -m "init"

# Copy the test script
COPY run-test.sh /app/run-test.sh
RUN chmod +x /app/run-test.sh

ENTRYPOINT ["/app/run-test.sh"]
