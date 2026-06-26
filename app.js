const audio = document.getElementById('audio-element');
const canvas = document.getElementById('visualizer');
const ctx = canvas.getContext('2d');

let audioCtx, analyser, source, filters = [];

// Cambiar de Pestañas
function switchTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
    document.getElementById(tabId).classList.add('active');
    event.currentTarget.classList.add('active');
}

// Inicializar el Contexto de Audio (Requerido por seguridad del navegador tras interactuar)
function initAudioEngine() {
    if (audioCtx) return;

    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    source = audioCtx.createMediaElementSource(audio);
    analyser = audioCtx.createAnalyser();
    
    // Configuración de Filtros del Ecualizador (BiquadFilterNode)
    const frecuencias = [60, 230, 910, 4000, 14000];
    let lastFilter = source;

    frecuencias.forEach((freq) => {
        let filter = audioCtx.createBiquadFilter();
        filter.type = (freq === 60) ? "lowshelf" : (freq === 14000) ? "highshelf" : "peaking";
        filter.frequency.value = freq;
        filter.Q.value = 1;
        filter.gain.value = 0;

        lastFilter.connect(filter);
        filters.push(filter);
        lastFilter = filter;
    });

    lastFilter.connect(analyser);
    analyser.connect(audioCtx.destination);

    setupVisualizer();
}

// Lógica del Visualizador Camuflado
function setupVisualizer() {
    analyser.fftSize = 128;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    function draw() {
        requestAnimationFrame(draw);
        analyser.getByteFrequencyData(dataArray);

        ctx.fillStyle = '#121212';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const barWidth = (canvas.width / bufferLength) * 1.5;
        let barHeight;
        let x = 0;

        for(let i = 0; i < bufferLength; i++) {
            barHeight = dataArray[i] / 1.5;
            // Dibujamos con un tono verde/azul sutil muy oscuro para camuflarse
            ctx.fillStyle = `rgba(29, 185, 84, ${barHeight / 255})`; 
            ctx.fillRect(x, canvas.height - barHeight, barWidth - 2, barHeight);
            x += barWidth;
        }
    }
    draw();
}

// Controladores de Eventos (Play / Local Files)
document.getElementById('btn-play').addEventListener('click', () => {
    initAudioEngine();
    if (audio.paused) {
        audio.play();
        document.getElementById('btn-play').innerHTML = '<i class="fas fa-pause"></i>';
    } else {
        audio.pause();
        document.getElementById('btn-play').innerHTML = '<i class="fas fa-play"></i>';
    }
});

document.getElementById('local-file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        document.getElementById('track-title').innerText = file.name;
        audio.src = URL.createObjectURL(file);
    }
});

// Controladores del Ecualizador
document.querySelectorAll('.eq-slider').forEach(slider => {
    slider.addEventListener('input', (e) => {
        initAudioEngine();
        const index = e.target.dataset.filter;
        if(filters[index]) {
            filters[index].gain.value = e.target.value;
        }
    });
});

// Buscar en API libre de Jamendo (Música Online)
async function searchOnlineMusic() {
    const query = document.getElementById('search-input').value;
    const client_id = '549df9c9'; // Client ID público de pruebas de Jamendo
    const url = `https://api.jamendo.com/v3.0/tracks/?client_id=${client_id}&format=json&limit=5&search=${query}`;

    try {
        const response = await fetch(url);
        const data = await response.json();
        const resultsUl = document.getElementById('online-results');
        resultsUl.innerHTML = '';

        data.results.forEach(track => {
            const li = document.createElement('li');
            li.innerHTML = `
                <span>${track.name}</span>
                <button onclick="playOnline('${track.audio}')">▶ Escuchar</button>
                <a href="${track.audio}" download="${track.name}.mp3" target="_blank" class="btn-descarga">📥 Bajar</a>
            `;
            resultsUl.appendChild(li);
        });
    } catch (err) {
        console.error("Error buscando música online", err);
    }
}

function playOnline(audioUrl) {
    initAudioEngine();
    audio.src = audioUrl;
    audio.play();
    document.getElementById('btn-play').innerHTML = '<i class="fas fa-pause"></i>';
}