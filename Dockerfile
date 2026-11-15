FROM nginx:alpine

RUN apk add --no-cache python3 \
  && mkdir -p /opt/dockfire

COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY deploy/entrypoint.sh /entrypoint.sh
COPY checker/checker.py /opt/dockfire/checker.py
COPY site/ /usr/share/nginx/html/

RUN chmod +x /entrypoint.sh \
  && chown -R nginx:nginx /usr/share/nginx/html /var/cache/nginx /var/run /opt/dockfire \
  && chmod -R a+rX /usr/share/nginx/html /opt/dockfire

# nginx master needs root to bind; workers drop privileges via nginx.conf defaults.
# Checker runs as root in alpine nginx image context — bind to high port only.
USER root
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
ENTRYPOINT ["/entrypoint.sh"]
