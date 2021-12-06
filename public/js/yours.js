const butts = document.getElementById('buttons').children;
const previews = [];
for (let but of butts) {
    previews.push(new Audio(but.dataset.url));
    but.onclick = src => {
        let audio = previews[but.dataset.id];
        if (but.classList.contains('clicked')) {
            but.classList.remove('clicked');
            if (!audio.paused) {
                audio.pause();
                audio.currentTime = 0;
                but.children[0].classList.remove('playing');
                but.children[1].firstChild.classList.remove('playyying');
            }
        } else {
            for (let b of butts) {
                b.classList.remove('clicked');
                b.children[0].classList.remove('playing');
                b.children[1].firstChild.classList.remove('playyying');
            }
            for (let a of previews) {
                if (!a.paused) {
                    a.pause();
                    a.currentTime = 0;
                }
            }
            but.classList.add('clicked');
            audio.play().then(x => {
                but.children[0].classList.add('playing');
                but.children[1].firstChild.classList.add('playyying');
            });
        }
    }
}