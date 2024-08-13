import requests
import re
import time
import pickle

from bs4 import BeautifulSoup
from concurrent.futures import ThreadPoolExecutor, as_completed
from multiprocessing import cpu_count

soup = BeautifulSoup(requests.get("http://everynoise.com/engenremap.html").text, "html.parser")
genres = soup.find_all("div", "genre scanme")
rows = []

def parse(genre):
    preview_url = genre['preview_url'][30:]
    _, top, left, _ = genre['style'].split(';')
    top = int(top.split()[1][:-2])
    left = int(left.split()[1][:-2])
    cleaned = genre.text.strip().replace("»", "")

    print("Pulling genre " + cleaned)
    soup2 = BeautifulSoup(requests.get("http://everynoise.com/engenremap-" + re.sub(r"[:'+»&\s-]", '', cleaned) + ".html").text, "html.parser")
    all_opp_genres = soup2.find_all("div", id=re.compile(r"^mirroritem\d+"))
    all_nearby_genres = soup2.find_all("div", id=re.compile(r"^nearbyitem\d+"))
    opp_genres, opp_weights, opp_urls = [], [], []
    nearby_genres, nearby_weights, nearby_urls = [], [], []
    
    for opp in all_opp_genres:
        opp_genres.append(opp.text.strip().replace("»", ""))
        opp_weights.append(int(opp['style'].split()[-1][:-1]))
        opp_urls.append(opp['preview_url'][30:])

    for nearby in all_nearby_genres:
        clean = nearby.text.strip().replace("»", "")
        if clean != cleaned:
            nearby_genres.append(clean)
            nearby_weights.append(int(nearby['style'].split()[-1][:-1]))
            nearby_urls.append(nearby['preview_url'][30:])
    
    return (cleaned, top, left, preview_url, tuple(nearby_genres), tuple(nearby_weights), tuple(nearby_urls), tuple(opp_genres), tuple(opp_weights), tuple(opp_urls))

if __name__ == '__main__':
    with ThreadPoolExecutor(max_workers=cpu_count()) as executor:
    # with ThreadPoolExecutor(max_workers=3) as executor:
        start = time.time()
        futures = [ executor.submit(parse, genre) for genre in genres ]
        for result in as_completed(futures):
            rows.append(result.result())

    end = time.time()
    print("Time Taken: {:.6f}s".format(end-start))

    with open("genres2.pkl", "wb") as f:
        pickle.dump(rows, f)
