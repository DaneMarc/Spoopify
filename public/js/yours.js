const buttons = document.getElementsByClassName('button');
const previews = [];
i = 0;
for (let but of buttons) {
    previews.push(new Audio(but.dataset.url));
    if (i > 4) {
        but.dataset.id = i;
    }
    but.onclick = src => {
        let audio = previews[but.dataset.id];
        if (but.classList.contains('clicked')) {
            but.classList.remove('no-hover');
            but.classList.remove('clicked');
            if (!audio.paused) {
                audio.pause();
                audio.currentTime = 0;
                but.children[0].classList.remove('playing');
                but.children[1].firstChild.classList.remove('playyying');
            }
        } else {
            but.classList.add('no-hover');
            for (let b of buttons) {
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
    i++;
}