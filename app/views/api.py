import json
import time

from flask import Blueprint, request, current_app, jsonify
from greenstalk import Client, TimedOutError, NotFoundError

from app.monitor import get as get_stats


bp = Blueprint('api', __name__)


@bp.route('/stats', methods=['GET'])
def stats():
    block = False if request.args.get('block') == '0' else True
    duration = int(request.args['duration']) if request.args.get('duration') else None
    since = float(request.args['since']) if request.args.get('since') else None
    def _mk_lines(data):
        for item in data:
            yield json.dumps(item) + '\n'

    def _mk_response():
        yield from _mk_lines(get_stats(block=block, since=since))
        if duration:
            s = time.monotonic()
            while time.monotonic() - s <= duration:
                yield from _mk_lines(get_stats(latest=True))

    return _mk_response()


@bp.route('/action', methods=['POST'])
def action():
    payload = request.json
    try:
        with Client((current_app.config['BEANSTALK_HOST'], current_app.config['BEANSTALK_PORT']), encoding=None, use=payload['tube'], watch=[payload['tube']]) as conn:
            if payload['action'] == 'pause':
                conn.pause_tube(payload['tube'], payload['count'])
            elif payload['action'] == 'bury':
                c = 0
                for fn in [conn.peek_ready, conn.peek_delayed]:
                    try:
                        while True:
                            j = fn()
                            if not j:
                                break
                            try:
                                j = conn.reserve_job(j.id)
                                conn.bury(j)
                                c += 1
                            except NotFoundError:
                                pass
                            if payload['count'] > 0 and c >= payload['count']:
                                break
                    except NotFoundError:
                        pass
            elif payload['action'] == 'purge':
                c = 0
                for fn in [conn.peek_ready, conn.peek_delayed, conn.peek_buried]:
                    try:
                        while True:
                            j = fn()
                            if not j:
                                break
                            try:
                                j = conn.reserve_job(j.id)
                                conn.delete(j)
                                c += 1
                            except NotFoundError:
                                pass
                            if payload['count'] > 0 and c >= payload['count']:
                                break
                    except NotFoundError:
                        pass
            elif payload['action'] == 'kick':
                if payload['count'] < 0:
                    stats = conn.stats_tube(payload['tube'])
                    payload['count'] = stats['current-jobs-buried'] or stats['current-jobs-delayed']
                conn.kick(payload['count'])
    except ConnectionError:
        return jsonify({'ok': False, 'error': "Failed to connect"})

    return jsonify({'ok': True})
