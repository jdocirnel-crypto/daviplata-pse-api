FROM mcr.microsoft.com/playwright:v1.60.0-jammy

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3000

ENV PORT=3000
ENV CAPTCHA_KEY=${CAPTCHA_KEY}

CMD ["node", "daviplata_api.js"]
