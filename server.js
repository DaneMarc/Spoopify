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
                "img-src": ["'self'", "https://i.scdn.co/image/", "https://daneeee.blob.core.windows.net/images/noimage.jpg"],
                "media-src": ["'self'", "https://p.scdn.co/mp3-preview/"]
            }
        }
    }));

const PORT = 1116;
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI || 'http://localhost:' + PORT + '/callback';
const STATE_KEY = 'spotify_auth_state';
const LIMIT = 50;
const NO_IMG = "https://daneeee.blob.core.windows.net/images/noimage.jpg";
const genreMap = new Map();
let client_token;

fs.createReadStream('genres.csv')
    .pipe(csv())
    .on('data', data => {
        genreMap.set(data.genre, [csvTrim(data.opps), JSON.parse(data.weights), csvTrim(data.links)]);
    }).on('end', () => console.log('genres loaded'));

getClientToken();
setInterval(getClientToken, 3600000);

app.listen(process.env.PORT || PORT, () => {
	console.log(`Server listening on port ${PORT}`);
});

app.get('/', (req, res) => {
	res.sendFile(__dirname + '/hey.html');
});

app.get('/login', (req, res) => {
    const state = generateRandomString(16);
    res.cookie(STATE_KEY, state);
    res.redirect('https://accounts.spotify.com/authorize?' + new URLSearchParams({
        response_type: 'code',
        client_id: CLIENT_ID,
        scope: 'user-top-read',
        redirect_uri: REDIRECT_URI,
        state: state
    }).toString());
});

app.get('/callback', (req, res) => {
    const code = req.query.code || null;
    const state = req.query.state || null;
    const storedState = req.cookies ? req.cookies[STATE_KEY] : null;

    if (state === null || state !== storedState) {
        return res.redirect('/#error=state_mismatch');
    }

    res.clearCookie(STATE_KEY);

    // Gets user token
    axios.post('https://accounts.spotify.com/api/token',
        new URLSearchParams({
            code: code,
            redirect_uri: REDIRECT_URI,
            grant_type: 'authorization_code'
        }).toString(), {
            headers: {'Authorization': 'Basic ' + Buffer.from(CLIENT_ID + ':' + CLIENT_SECRET).toString('base64')}
        }
    ).then(body => {
        if (body.status !== 200) {
            console.log('invalid token');
            return res.redirect('/#error=invalid_token');
        }
        console.log('token retrieved');
        const access_token = body.data.access_token;
        const params = new URLSearchParams({'limit': LIMIT, time_range: 'long_term'}).toString();
        const userHeaders = { 
            headers: {
                'Authorization': 'Bearer ' + access_token,
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            }
        };
        
        // Gets user's top artists and tracks
        Promise.all([axios.get('https://api.spotify.com/v1/me/top/tracks?' + params, userHeaders),
                axios.get('https://api.spotify.com/v1/me/top/artists?' + params, userHeaders)]).then(userData => {
            if (userData[0].data.items.length == 0) {
                return res.sendFile(__dirname + '/nodata.html');
            }

            const tracks = userData[0].data.items;
            const artists = userData[1].data.items;
            const numOfTracks = tracks.length;
            const numOfArtists = artists.length;
            const BIG_WEIGHT = numOfTracks * 2;

            const genreWeights = new Map(); // Genre weightage
            const artistGenres = new Map(); // Genres associated with each artist
            const promises = [];
            const imgs = [];

            let max = 0;
            let totalPopularity = 0;
            let minPopTrack = 101;
            let minPopTrackId;
            let minPopArtist = 101;
            let minPopArtistId;

            const clientHeaders = {
                headers: {
                    'Authorization': 'Bearer ' + client_token,
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                }
            };

            // Assigns weightage to genres of top artists
            for (let i = 0; i < numOfArtists; i++) {
                if (artists[i].popularity < minPopArtist) {
                    minPopArtist = artists[i].popularity;
                    minPopArtistId = artists[i];
                }

                artistGenres.set(artists[i].id, artists[i].genres);

                for (const genre of artists[i].genres) {
                    if (genreWeights.has(genre)) {
                        genreWeights.set(genre, genreWeights.get(genre) + numOfArtists - i);
                    } else {
                        genreWeights.set(genre, numOfArtists - i);
                    }
                }
            }

            // Assigns weightage to artists of top tracks
            for (let i = 0; i < numOfTracks; i++) {
                const track = tracks[i];
                totalPopularity += track.popularity;

                // Gets album covers of the user's top 5 tracks
                if (i < 6) {
                    imgs.push(getAlbumImage(track));
                }

                // Gets user's least popular favourite track
                if (track.popularity < minPopTrack) {
                    minPopTrack = track.popularity;
                    minPopTrackId = track;
                }

                for (const artist of track.artists) {
                    if (artistGenres.has(artist.id)) {
                        for (const genre of artistGenres.get(artist.id)) {
                            let weight;

                            if (genreWeights.has(genre)) {
                                weight = genreWeights.get(genre) + (BIG_WEIGHT - i) / track.artists.length;
                            } else {
                                weight = (BIG_WEIGHT - i) / track.artists.length;
                            }

                            // stores the max genre weightage to reduce unnecessary computation later on
                            if (weight > max) {
                                max = weight;
                            }

                            genreWeights.set(genre, weight);
                        }
                    }
                }
            }
            
            // Assigns weightage to their corresponding genres
            const opps = new Map();

            // Assigns weightage to dissimilar genres
            for (const [key, value] of genreWeights.entries()) {

                // Skips genre if it cannot possibly be the most loved/hated
                if (value * 16 >= max * 10 && genreMap.has(key)) {
                    const genreData = genreMap.get(key);

                    for (i = 0; i < genreData[0].length; i++) {
                        const genre = genreData[0][i];

                        if (opps.has(genre)) {
                            const oppItem = opps.get(genre);
                            oppItem.weight += genreData[1][i] * value;
                        } else {
                            opps.set(genre, {
                                genre: genre,
                                weight: genreData[1][i] * value,
                                url: 'https://p.scdn.co/mp3-preview/' + genreData[2][i]
                            });
                        }
                    }
                }
            }

            return res.render('yours', { 
                loves: imgs, 
                hates: Array.from(opps.values()).sort((a, b) => b.weight - a.weight).slice(0, 6),
                score: totalPopularity / numOfTracks,
                desc: getBasic(totalPopularity / numOfTracks),
                trackUrl: getAlbumImage(minPopTrackId),
                trackName: Object.hasOwn(minPopTrackId, 'name') ? minPopTrackId.name : 'Unknown',
                artistUrl: getArtistImage(minPopArtistId),
                artistName: Object.hasOwn(minPopArtistId, 'name') ? minPopArtistId.name : 'Unknown'
            });

        }).catch(err => {
            console.log('error from getting user\'s top tracks and artists')
            console.log(err);
            console.log(err.status);
            console.log(err.message);
            res.sendFile(__dirname + '/error.html');
        });
    }).catch(err => {
        console.log('error from getting authorization code')
        console.log(err);
        console.log(err.status);
        console.log(err.message);
        res.sendFile(__dirname + '/hey.html');
    });
});

// Generates a random 16 character string for cookies
const generateRandomString = function(length) {
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let text = '';

    for (let i = 0; i < length; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }

    return text;
};

// Returns an array of genres given a its string representation from the csv file
// Used in place of JSOn.parse() as parse() does not play well with certain characters found in the genres
const csvTrim = genreString => {
    const arr = genreString.slice(1,-1).split(',');

    for (i = 0; i < arr.length; i++) {
        arr[i] = arr[i].slice(1,-1);
    }

    return arr;
}


// Gets the user's basic description based on their average song popularity
const getBasic = score => {
    if (score >=  80) {
        return "White girl";
    } else if (score >= 60) {
        return "Average";
    } else if (score >= 40) {
        return "Indie kid";
    } else if (score >= 20) {
        return "Weirdo";
    } else {
        return "Apologies for interrupting your grindset";
    }
}

// Retrieves a client token if one is not found/expired
// Allows the server to access song and artist data
function getClientToken() {
    axios.post('https://accounts.spotify.com/api/token',
        new URLSearchParams({
            grant_type: 'client_credentials'
        }).toString(),
        { headers: { 'Authorization': 'Basic ' + Buffer.from(CLIENT_ID + ':' + CLIENT_SECRET).toString('base64') }}
    ).then(body => {
        client_token = body.data.access_token;
        console.log('client token retrieved');
    }).catch(err => console.log(err));
}

const getAlbumImage = track => {
    if (track != null && Object.hasOwn(track, 'album') && track.album.images.length > 0) {
        if (track.album.images.length > 1) {
            return track.album.images[1].url;
        } else {
            return track.album.images[0].url;
        }
    } else {
        return NO_IMG;
    }
}

const getArtistImage = artist => {
    if (artist != null && Object.hasOwn(artist, 'images') && artist.images.length > 0) {
        if (artist.images.length == 1) {
            return artist.images[0].url;
        } else {
            return artist.images[1].url;
        }
    } else {
        return NO_IMG;
    }
}
