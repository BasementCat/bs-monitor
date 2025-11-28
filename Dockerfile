FROM alpine:3.22

EXPOSE 5000

WORKDIR /app

RUN apk add --no-cache \
        python3 \
        py3-pip \
        ca-certificates

RUN pip3 config set global.break-system-packages true
RUN pip3 install pipenv

COPY Pipfile* ./
RUN pipenv install --system --deploy

COPY . .

ENTRYPOINT [ "flask", "run", "--host", "0.0.0.0" ]
