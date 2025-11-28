(function() {
    const Stats = {
        _stats: [],
        _buffer: '',
        _last_ts: null,
        _all_callbacks: [],
        _latest_callbacks: [],

        onUpdate: function(callback) {
            this._all_callbacks.push(callback);
            if (this._stats.length) {
                callback(this._stats);
            }
        },

        onUpdateLatest: function(callback) {
            this._latest_callbacks.push(callback);
            if (this._stats.length) {
                callback(this._stats[this._stats.length - 1]);
            }
        },

        fetch: async function(firstcall) {
            let url = CONFIG.stats_url;
            let args = '?'
            if (firstcall) {
                args += '&block=0';
            } else {
                args += '&duration=10';
                if (this._last_ts !== null) {
                    args += '&since=' + (this._last_ts - 5);
                }
            }
            url += args;
            // console.log("fetch %s", url);
            const response = await fetch(url);

            const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
            while (true) {
                const { done, value } = await reader.read();
                if (done) {
                    break;
                }
                this._buffer += value;
                // console.log("read chunk of len %d, buffer len is now %d and parse", value.length, this._buffer.length);
                if (!firstcall) {
                    // on first call, defer parsing until we've read the entire response
                    this._parse();
                }
            }
            this._parse();
            window.setTimeout(this.fetch.bind(this), 900);
        },

        _parse: function() {
            let items;
            if (this._buffer) {
                if (this._buffer.match(/\n$/)) {
                    items = this._buffer.trim().split("\n");
                    // console.log("buffer endswith newline and contains %d items", items.length);
                    this._buffer = '';
                } else {
                    items = this._buffer.split("\n");
                    this._buffer = items.pop();
                    // console.log("buffer incomplete and contains %d items, new buffer len is %d", items.length, this._buffer.length);
                }
                this._append(items.map(i => JSON.parse(i)).filter(i => i));
            }
        },

        _append: function(items) {
            if (this._last_ts) {
                items = items.filter(i => i.ts > this._last_ts);
            }
            items = items.toSorted((a, b) => a.ts - b.ts);
            for (const item of items) {
                this._stats.push(item);
            }
            if (this._stats.length > 0) {
                this._last_ts = this._stats[this._stats.length - 1].ts;
            }
            this._prune();
            this._notify();
            // console.log(this._stats.length);
        },

        _prune: function() {
            const cutoff = ((new Date()).getTime() / 1000) - 86400;
            this._stats = Array.from(this._stats.filter(i => i.ts >= cutoff));
        },

        _notify: function() {
            if (this._stats.length) {
                this._all_callbacks.forEach(c => c(this._stats));
                const last = this._stats[this._stats.length - 1];
                this._latest_callbacks.forEach(c => c(last));
            }
        }
    };

    class ServerStatItem {
        constructor(el) {
            this.el = el;
            this.type = el.dataset.type;
            this.stat = el.dataset.stat;
            this.invert = false;
            if (this.stat.match(/^!/)) {
                this.invert = true;
                this.stat = this.stat.substr(1);
            }
        }

        getStatValue(s) {
            if (this.stat == 'connected') {
                return s.connected;
            } else if (this.type === 'toggle' || this.type == 'show') {
                if (s.server) {
                    return s.server[this.stat] === 'true';
                }
                return null;
            } else {
                if (s.server) {
                    return s.server[this.stat];
                }
                return null;
            }
        }

        update(s) {
            let val = this.getStatValue(s);
            if (val === null) {
                return;
            }
            if (this.invert) {
                val = !val;
            }
            switch (this.type) {
                case 'toggle':
                    this.el.style.display = val ? 'inline' : 'none';
                    break;
                case 'show':
                    if (val) {
                        this.el.style.display = 'inline';
                    }
                    break;
                case 'target':
                    this.el.innerText = val;
                    break;
            }
        }
    }

    const ServerStats = {
        init: function() {
            this.sstats = Array.from(Array.from(document.querySelectorAll('.sstat')).map(el => new ServerStatItem(el)));
            Stats.onUpdateLatest(this.handleStats.bind(this));
        },

        handleStats: function(s) {
            this.sstats.forEach(i => i.update(s));
        },
    };

    class TubeStatItem {
        constructor(tube, el) {
            this.tube = tube;
            this.el = el;
            this.stat = el.dataset.stat;
        }

        getStatValue(s) {
            if (s.tubes && s.tubes[this.tube]) {
                return s.tubes[this.tube][this.stat];
            }
            return null;
        }

        update(s) {
            let val = this.getStatValue(s);
            if (val === null) {
                return;
            }
            this.el.innerText = val;
        }
    }

    class Tube {
        constructor(tube) {
            this.tube = tube;
            const statTable = document.querySelector('#tube-stats');
            const template = statTable.querySelector('.tstat-row.template');
            this.row = template.cloneNode(true);
            this.row.classList.remove('template');
            this.row.style.display = "table-row";
            this.row.dataset.tube = tube;
            this.tstats = Array.from(Array.from(this.row.querySelectorAll('.tstat')).map(el => new TubeStatItem(tube, el)));
            statTable.querySelector('tbody').appendChild(this.row);
        }

        isValid(s) {
            return s.tubes.hasOwnProperty(this.tube);
        }

        remove() {
            this.row.remove();
        }

        update(s) {
            this.tstats.forEach(t => t.update(s));
        }
    }

    const TubeStats = {
        init: function() {
            this.tstats = [];
            Stats.onUpdateLatest(this.handleStats.bind(this));
            document.querySelector('#tube-stats').addEventListener('click', this.handleClick.bind(this));
        },

        handleStats: function(s) {
            if (s.tubes === null) {
                return;
            }
            const haveTubes = Array.from(this.tstats.map(t => t.tube));
            Object.keys(s.tubes).filter(t => !haveTubes.includes(t)).forEach(t => this.tstats.push(new Tube(t)));
            this.tstats.filter(t => !t.isValid(s)).forEach(t => t.remove());
            this.tstats = Array.from(this.tstats.filter(t => t.isValid(s)));
            this.tstats.forEach(t => t.update(s));
        },

        handleClick: async function(e) {
            const button = e.target.closest('.tube-action');
            if (button) {
                e.stopPropagation();
                e.preventDefault();
                const tube = button.closest('.tstat-row').dataset.tube;
                let payload = {
                    'tube': tube,
                    'action': button.dataset.action,
                    'count': parseInt(button.dataset.count),
                };
                if (button.dataset.asktext) {
                    let count = window.prompt(button.dataset.asktext.replace('{tube}', tube));
                    if (!count) {
                        return;
                    }
                    count = parseInt(count);
                    if (isNaN(count)) {
                        alert("Please enter a number");
                        return;
                    }
                    if (!count) {
                        return;
                    }
                    payload.count = count;
                }
                if (button.dataset.confirmtext) {
                    if (!window.confirm(button.dataset.confirmtext)) {
                        return;
                    }
                }

                const res = await fetch(CONFIG.action_url, {
                    method: 'POST',
                    headers: {
                        'Accept': 'application/json',
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(payload)
                });
                const content = await res.json();

                console.log(content);
            }
        },
    };


    Stats.fetch(true);
    ServerStats.init();
    TubeStats.init();
})();