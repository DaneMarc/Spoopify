const express = require('express');
const app = express();
const path = require('path');
const cookieParser = require('cookie-parser');
const compression = require('compression');
const helmet = require("helmet");
const csv = require('csv-parser');
const fs = require('fs');
const { default: axios } = require('axios');
require('dotenv').config();
app.set('views', path.join(__dirname,'views'));
app.set('view engine', 'hbs');
app.use(express.static('public'))
    .use(cookieParser())
    .use(express.urlencoded({extended: true}))
    .use(express.json())
    .use(compression())
    .use(helmet({
        contentSecurityPolicy: {
            useDefaults: true,
            directives: {
                "img-src": ["'self'", "https://i.scdn.co/image/"],
                "media-src": ["'self'", "https://p.scdn.co/mp3-preview/"]
            }
        }
    }));

const port = 1116;
const client_id = process.env.CLIENT_ID;
const client_secret = process.env.CLIENT_SECRET;
const redirect_uri = process.env.REDIRECT_URI || 'http://localhost:' + port + '/callback';
let stateKey = 'spotify_auth_state';
const mappa = new Map();
let client_token;

fs.createReadStream('genres.csv')
    .pipe(csv())
    .on('data', data => {
        mappa.set(data.genre, [csvtrim(data.opps), JSON.parse(data.weights), csvtrim(data.links)]);
    }).on('end', () => console.log('genres loaded'));

getClientToken();
setInterval(getClientToken, 3600000);

app.listen(process.env.PORT || port, () => {
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
        scope: 'user-top-read',
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
                let access_token = body.data.access_token
                const limit = 50;
                let headers = { headers: {
                    'Authorization': 'Bearer ' + access_token,
                    'Accept': 'application/json',
                    'Content-Type': 'application/json' }
                };
                const params = new URLSearchParams({'limit': limit, time_range: 'long_term'}).toString();

                Promise.all([axios.get('https://api.spotify.com/v1/me/top/tracks?' + params, headers), axios.get('https://api.spotify.com/v1/me/top/artists?' + params, headers)]).then(rex => {
                    const tracks = rex[0].data.items;
                    const artists = rex[1].data.items;
                    const numOfItems = tracks.length;
                    const numOfArtists = artists.length;
                    if (numOfItems > 0) {
                        const twice = numOfItems * 2;
                        const trackMap = new Map(); // artist weights
                        const map = new Map(); // genre weights
                        const oo = new Map();
                        const promises = [];
                        const imgs = [];
                        let temp, opps;
                        let t = 0, max = 0;
                        let popSum = 0;
                        let minPopTrack = 100, minPopTrackId;
                        let minPopArtist = 100, minPopArtistId;

                        for (i = 0; i < numOfArtists; i++) { // assigns weightage to genres of top artists
                            if (artists[i].popularity < minPopArtist)
                                minPopArtistId = artists[i];
                            oo.set(artists[i].id, artists[i].genres);
                            for (const genre of artists[i].genres) {
                                if (map.has(genre)) {
                                    map.set(genre, map.get(genre) + numOfArtists - i);
                                } else {
                                    map.set(genre, numOfArtists - i);
                                }
                            }
                        }

                        for (i = 0; i < numOfItems; i++) { //assigns weightage to artists of top tracks
                            temp = tracks[i];
                            if (i < 6)
                                imgs.push(temp.album.images[1].url);
                            popSum += temp.popularity;
                            if (temp.popularity < minPopTrack)
                                minPopTrackId = temp;
                            for (const artist of temp.artists) {
                                if (oo.has(artist.id)) {
                                    for (const genre of oo.get(artist.id)) {
                                        if (map.has(genre)) {
                                            t = map.get(genre) + (twice - i) / temp.artists.length;
                                        } else {
                                            t = (twice - i) / temp.artists.length;
                                        }
                                        if (t > max)
                                            max = t;
                                        map.set(genre, t);
                                    }
                                } else {
                                    if (trackMap.has(artist.id)) {
                                        trackMap.set(artist.id, trackMap.get(artist.id) + (twice - i) / temp.artists.length);
                                    } else {
                                        trackMap.set(artist.id, (twice - i) / temp.artists.length);
                                    }
                                }
                            }
                        }
                        
                        oo.clear();
                        headers = { headers: {
                            'Authorization': 'Bearer ' + client_token,
                            'Accept': 'application/json',
                            'Content-Type': 'application/json' }
                        };

                        if (trackMap.size > 0) {
                            t = 0;
                            temp = Array.from(trackMap.keys());
                            while (temp.length - t > limit) {
                                promises.push(axios.get('https://api.spotify.com/v1/artists?' + new URLSearchParams({'ids': temp.slice(t, t + limit).join()}).toString(), headers));
                                t += limit;
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
                                            opps.weight += temp[1][i] * value;
                                        } else {
                                            oo.set(t, { genre: t, weight: temp[1][i] * value, url: 'https://p.scdn.co/mp3-preview/' + temp[2][i] });
                                        }
                                    }
                                }
                            }
        
                            opps = Array.from(oo.values()).sort((a, b) => b.weight - a.weight).slice(0, 6);
                            //console.log(opps);
                            t = popSum / numOfItems;
                            res.render('yours', { 
                                loves: imgs, 
                                hates: opps,
                                score: t,
                                desc: getBasic(t),
                                trackUrl: minPopTrackId.album.images[1].url,
                                trackName: minPopTrackId.name,
                                artistUrl: minPopArtistId.images[2].url,
                                artistName: minPopArtistId.name
                            });
                        }).catch(err => { console.log(err); res.sendFile(__dirname + '/error.html'); });
                    } else {
                        res.sendFile(__dirname + '/nodata.html');
                    }
                }).catch(err => { console.log(err); res.sendFile(__dirname + '/error.html'); });
            } else {
                res.redirect('/#error=invalid_token');
            }
        }).catch(err => { console.log(err); res.sendFile(__dirname + '/error.html'); });
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

const getBasic = score => {
    if (score >=  80) {
        return "White girl";
    } else if (score >= 60) {
        return "Average (Taylor's Version)";
    } else if (score >= 40) {
        return "Average";
    } else if (score >= 20) {
        return "Indie kid";
    } else {
        return "Sorry for interrupting your grindset";
    }
}

function getClientToken() {
    axios.post('https://accounts.spotify.com/api/token',
        new URLSearchParams({
            grant_type: 'client_credentials'
        }).toString(),
        { headers: { 'Authorization': 'Basic ' + Buffer.from(client_id + ':' + client_secret).toString('base64') }}
    ).then(body => {
        client_token = body.data.access_token;
        console.log('client access token retrieved');
    }).catch(err => console.log(err));
}
