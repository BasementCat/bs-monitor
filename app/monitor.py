import time
from collections import deque
from threading import Thread, Condition
import logging

from greenstalk import Client


_data = _thread = _conn = None
_newstats = Condition()
logger = logging.getLogger()


def start(app):
    global _data, _thread

    if _thread is None:
        _data = deque([], int(app.config['STATS_LIMIT'] / app.config['STATS_INTERVAL']))
        _thread = Thread(target=run, daemon=True, args=[dict(app.config)])
        logger.info("Starting monitor thread")
        _thread.start()


def run(config):
    global _conn

    def _get_conn():
        global _conn
        if _conn is None:
            try:
                _conn = Client((config['BEANSTALK_HOST'], config['BEANSTALK_PORT']))
                logger.debug("Connected to %s:%d", config['BEANSTALK_HOST'], config['BEANSTALK_PORT'])
            except ConnectionError as e:
                logger.error("Failed to connect to %s:%d: %s", config['BEANSTALK_HOST'], config['BEANSTALK_PORT'], e)
            except Exception as e:
                logger.error("Unexpected error connecting to %s:%d", config['BEANSTALK_HOST'], config['BEANSTALK_PORT'], exc_info=True)
        return _conn

    while True:
        ls = time.monotonic()
        ts = time.time()
        _conn = _get_conn()
        with _newstats:
            connected = False
            sstats = tstats = None
            if _conn:
                connected = True
                try:
                    sstats = _conn.stats()
                    tstats = {t: _conn.stats_tube(t) for t in _conn.tubes()}
                except ConnectionError as e:
                    logger.error("Lost connection to %s:%d: %s", config['BEANSTALK_HOST'], config['BEANSTALK_PORT'], e)
                    _conn = sstats = tstats = None
                    connected = False
            _data.appendleft({
                'ts': ts,
                'connected': connected,
                'server': sstats,
                'tubes': tstats,
            })
            _newstats.notify_all()
        time.sleep(config['STATS_INTERVAL'] - (time.monotonic() - ls))


def get(block=True, since=None, latest=False):
    if block:
        with _newstats:
            _newstats.wait()
    if latest:
        return [_data[0]]
    elif since:
        return [d for d in _data if d['ts'] >= since]
    return list(_data)
