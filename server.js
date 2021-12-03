const express = require('express');
const app = express();
const cookieParser = require('cookie-parser');
const compression = require('compression');
const csv = require('csv-parser');
const mustache = require('mustache');
const fs = require('fs');
const { default: axios } = require('axios');
require('dotenv').config();
app.use(express.static('public'))
    .use(cookieParser())
    .use(express.urlencoded({extended: true}))
    .use(express.json())
    .use(compression());

const port = 1116;
const client_id = process.env.CLIENT_ID;
const client_secret = process.env.CLIENT_SECRET;
const redirect_uri = 'http://localhost:' + port + '/callback';
let stateKey = 'spotify_auth_state';
const mappa = new Map();

fs.createReadStream('genres.csv')
    .pipe(csv())
    .on('data', data => {
        mappa.set(data.genre, [csvtrim(data.opps), JSON.parse(data.weights), csvtrim(data.links)]);
    }).on('end', () => {
        //console.log(mappa.get('italian metal')[0][1]);
        console.log('genres loaded');
    });

app.listen(port, () => {
	console.log(`Server listening on port ${port}`);
});

app.get('/', (req, res) => {
	res.sendFile(__dirname + '/hey.html');
});

app.get('/login', (req, res) => {
    let state = generateRandomString(16);
    res.cookie(stateKey, state);
    res.redirect('https://accounts.spotify.com/authorize?' + new URLSearchParams({
        response_type: 'code',
        client_id: client_id,
        scope: 'user-top-read playlist-modify-public playlist-modify-private',
        redirect_uri: redirect_uri,
        state: state
    }).toString());
});

app.get('/callback', (req, res) => {
    let code = req.query.code || null;
    let state = req.query.state || null;
    let storedState = req.cookies ? req.cookies[stateKey] : null;
    if (state === null || state !== storedState) {
        res.redirect('/#error=state_mismatch');
    } else {
        res.clearCookie(stateKey);
        axios.post('https://accounts.spotify.com/api/token',
            new URLSearchParams({
                code: code,
                redirect_uri: redirect_uri,
                grant_type: 'authorization_code'
            }).toString(), {
            headers: {
                'Authorization': 'Basic ' + Buffer.from(client_id + ':' + client_secret).toString('base64')
            }}
        ).then(body => {
            if (body.status === 200) {
                let access_token = body.data.access_token//, refresh_token = body.data.refresh_token;
                const numOfItems = 50;
                const twice = numOfItems * 2;
                const headers = { headers: {
                    'Authorization': 'Bearer ' + access_token,
                    'Accept': 'application/json',
                    'Content-Type': 'application/json' }
                };
                const params = new URLSearchParams({'limit': numOfItems, time_range: 'long_term'}).toString();

                Promise.all([axios.get('https://api.spotify.com/v1/me/top/tracks?' + params, headers), axios.get('https://api.spotify.com/v1/me/top/artists?' + params, headers)]).then(res => {
                    const tracks = res[0].data.items;
                    const artists = res[1].data.items;
                    const trackMap = new Map(); // artist weights
                    const map = new Map(); // genre weights
                    const oo = new Map();
                    const promises = [];
                    let temp, opps;
                    let t = 0, max = 0;

                    for (i = 0; i < numOfItems; i++) { // assigns weightage to genres of top artists
                        oo.set(artists[i].id, artists[i].genres);
                        for (const genre of artists[i].genres) {
                            if (map.has(genre)) {
                                map.set(genre, map.get(genre) + numOfItems - i);
                            } else {
                                map.set(genre, numOfItems - i);
                            }
                        }
                    }

                    for (i = 0; i < numOfItems; i++) { //assigns weightage to artists of top tracks
                        temp = tracks[i].artists;
                        for (const artist of temp) {
                            if (oo.has(artist.id)) {
                                for (const genre of oo.get(artist.id)) {
                                    if (map.has(genre)) {
                                        t = map.get(genre) + (twice - i) / temp.length;
                                    } else {
                                        t = (twice - i) / temp.length;
                                    }
                                    if (t > max)
                                        max = t;
                                    map.set(genre, t);
                                }
                            } else {
                                if (trackMap.has(artist.id)) {
                                    trackMap.set(artist.id, trackMap.get(artist.id) + (twice - i) / temp.length);
                                } else {
                                    trackMap.set(artist.id, (twice - i) / temp.length);
                                }
                            }
                        }
                    }
                    
                    oo.clear();

                    if (trackMap.size > 0) {
                        t = 0;
                        temp = Array.from(trackMap.keys());
                        while (temp.length - t > numOfItems) {
                            promises.push(axios.get('https://api.spotify.com/v1/artists?' + new URLSearchParams({'ids': temp.slice(t, t + numOfItems).join()}).toString(), headers));
                            t += numOfItems;
                        }
                        promises.push(axios.get('https://api.spotify.com/v1/artists?' + new URLSearchParams({'ids': temp.slice(t, temp.length).join()}).toString(), headers));
                    }

                    Promise.all(promises).then(ress => { // gets data on all artists of top tracks and assigns weightage to genres
                        for (const arr of ress) {
                            for (const artist of arr.data.artists) {
                                for (const genre of artist.genres) {
                                    if (map.has(genre)) {
                                        t = map.get(genre) + trackMap.get(artist.id);
                                    } else {
                                        t = trackMap.get(artist.id);
                                    }
                                    if (t > max)
                                        max = t;
                                    map.set(genre, t);
                                }
                            }
                        }
    
                        for (const [key, value] of map.entries()) { // assigns weightage to dissimilar genres
                            if (value * 160 >= max * 100) {
                                temp = mappa.get(key);
                                for (i = 0; i < temp[0].length; i++) {
                                    t = temp[0][i];
                                    if (oo.has(t)) {
                                        opps = oo.get(t);
                                        oo.set(t, [opps[0] + temp[1][i] * value, opps[1]]);
                                    } else {
                                        oo.set(t, [temp[1][i] * value, temp[2][i]]);
                                    }
                                }
                            }
                        }
    
                        opps = Array.from(oo.entries()).sort((a, b) => b[1][0] - a[1][0]).slice(0, 10);
                        console.log(opps);
                    }).catch(err => console.log(err));
                }).catch(err => console.log(err));

                res.sendFile(__dirname + '/yours.html');
            } else {
                res.redirect('/#error=invalid_token');
            }
        }).catch(err => console.log(err));
    }
});

const generateRandomString = function(length) {
    let text = '';
    let possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

    for (let i = 0; i < length; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
};

const csvtrim = arr => {
    arr = arr.slice(1,-1).split(',');
    for (i = 0; i < arr.length; i++) 
        arr[i] = arr[i].slice(1,-1);
    return arr;
}
