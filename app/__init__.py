import os
import logging

from flask import Flask
from flask_bootstrap import Bootstrap



logging.basicConfig(level=logging.DEBUG)


def create_app():
    app = Flask(__name__)

    app.config.from_prefixed_env()
    app.config.setdefault('BEANSTALK_HOST', 'localhost')
    app.config.setdefault('BEANSTALK_PORT', 11300)
    app.config.setdefault('STATS_LIMIT', 86400)
    app.config.setdefault('STATS_INTERVAL', 1)
    app.config['BOOTSTRAP_SERVE_LOCAL'] = True

    Bootstrap(app)

    from app.views import (
        index as index_view,
        api as api_view,
    )

    app.register_blueprint(index_view.bp)
    app.register_blueprint(api_view.bp, url_prefix='/api')

    from . import monitor
    monitor.start(app)

    return app
