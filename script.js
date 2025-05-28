const firebaseConfig = {
    apiKey: "AIzaSyDDDa_9qMq0NPAzokI6WbIQzC-mMoqjp50",
    authDomain: "mapa-geral-3c528.firebaseapp.com",
    projectId: "mapa-geral-3c528",
    storageBucket: "mapa-geral-3c528.firebasestorage.app",
    messagingSenderId: "7555704710",
    appId: "1:7555704710:web:6b0a0004b20a674f6a2e07",
};

// =============================================================
// ESTAS LINHAS ABAIXO SÃO CRÍTICAS E DEVEM ESTAR AQUI!
// Elas definem 'auth' e 'storage' globalmente para o script.
// Remova QUALQUER bloco try/catch de teste que você tinha aqui.
// =============================================================
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const storage = firebase.storage();
// =============================================================

console.log("Firebase app e instâncias auth/storage inicializadas globalmente.");


document.addEventListener('DOMContentLoaded', () => {

    // Centraliza o mapa na Rua Osvaldo dos Santos com um zoom inicial de 16
    var mapa = L.map('mapa').setView([-11.276615, -37.447377], 12);

    // Adiciona a camada base do OpenStreetMap
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap'
    }).addTo(mapa);

    // --- Definição do sistema de projeção UTM ---
    proj4.defs("EPSG:31984", "+proj=utm +zone=24 +south +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs");
    proj4.defs("EPSG:4326", "+proj=longlat +datum=WGS84 +no_defs");

    // Função para reprojetar um GeoJSON de uma projeção para WGS84
    function reprojectGeoJSON(geojson, sourceCrs) {
        const reprojected = JSON.parse(JSON.stringify(geojson));
        reprojected.features.forEach(feature => {
            if (feature.geometry && feature.geometry.coordinates) {
                const transformCoordinates = (coords) => {
                    if (Array.isArray(coords) && typeof coords[0] === 'number') {
                        if (isNaN(coords[0]) || isNaN(coords[1])) {
                            console.warn("Coordenadas inválidas encontradas, pulando reprojeção para:", coords);
                            return coords;
                        }
                        return proj4(sourceCrs, "EPSG:4326", [coords[0], coords[1]]);
                    }
                    else if (Array.isArray(coords[0])) {
                        return coords.map(transformCoordinates);
                    }
                    return coords;
                };
                feature.geometry.coordinates = transformCoordinates(feature.geometry.coordinates);
            }
        });
        return reprojected;
    }

    // Referências aos elementos HTML
    const loginContainer = document.getElementById('login-container');
    const mapaContainer = document.getElementById('mapa-container');
    const emailInput = document.getElementById('email');
    const senhaInput = document.getElementById('senha');
    const btnLogin = document.getElementById('btn-login');
    const btnLogout = document.getElementById('btn-logout');
    const mensagemErro = document.getElementById('mensagem-erro');
    const layerControl = document.getElementById('layer-control');
    const checkboxes = layerControl.querySelectorAll('input[type="checkbox"]');

    // Modificação: Objeto para armazenar as camadas GeoJSON, associando o nome do arquivo à camada Leaflet.
    // Isso nos permitirá ligar/desligar camadas específicas.
    let loadedGeojsonLayers = {}; // De 'geojsonLayers' para 'loadedGeojsonLayers' como um objeto

    // Lista de nomes de arquivos GeoJSON no Firebase Storage e seus estados padrão
    // Esta lista agora inclui o estado inicial (checked: true/false)
    const geojsonLayerConfigs = [
        { name: 'chaves.geojson', label: 'Chaves', checked: false },
        { name: 'postes.geojson', label: 'Postes', checked: false },
        { name: 'rede_bt.geojson', label: 'Rede BT', checked: true }, // DEFAULT: REDE BT ATIVA
        { name: 'rede_mt.geojson', label: 'Rede MT', checked: true }, //DEFAULT: REDE MT ATIVA
        { name: 'transformadores.geojson', label: 'Transformadores', checked: false }
    ];

    function mostrarErro(mensagem) {
        mensagemErro.textContent = mensagem;
        setTimeout(() => {
            mensagemErro.textContent = '';
        }, 5000);
    }

    // Função para carregar e adicionar um GeoJSON ao mapa
    // Esta função agora também aceita um parâmetro 'visible'
    async function loadAndAddGeoJSON(fileName, visible = true) {
        const geojsonRef = storage.ref(`geojson_data/${fileName}`);

        try {
            const url = await geojsonRef.getDownloadURL();
            const response = await fetch(url);

            if (!response.ok) {
                throw new Error(`Erro ao carregar ${fileName}: ${response.status}`);
            }
            const data = await response.json();

            const reprojectedGeoJSON = reprojectGeoJSON(data, "EPSG:31984");
            const correctedGeoJSON = turf.rewind(reprojectedGeoJSON, { reverse: false });

            const layer = L.geoJSON(correctedGeoJSON, {
                style: function (feature) {
                    return {
                        color: '#3388ff',
                        weight: 2,
                        opacity: 0.8,
                        fillColor: '#3388ff',
                        fillOpacity: 0.5
                    };
                },
                onEachFeature: function (feature, layer) {
                    if (feature.properties) {
                        let popupContent = '';
                        for (const key in feature.properties) {
                            if (feature.properties.hasOwnProperty(key) && feature.properties[key] !== null) {
                                popupContent += `<b>${key}:</b> ${feature.properties[key]}<br>`;
                            }
                        }
                        if (popupContent) {
                            layer.bindPopup(popupContent);
                        }
                    }
                }
            }); // Não adicione ao mapa ainda, apenas crie a camada

            // Armazena a camada no objeto, usando o nome do arquivo como chave
            loadedGeojsonLayers[fileName] = layer;

            if (visible) {
                layer.addTo(mapa); // Adiciona ao mapa se for para ser visível
            }

            return layer; // Retorna a camada para ajuste de bounds, se necessário
        } catch (error) {
            console.error(`Erro ao carregar ou processar ${fileName}:`, error);
            mostrarErro(`Falha ao carregar dados do mapa: ${fileName}.`);
            return null;
        }
    }

    // Função para carregar TODAS as camadas GeoJSON e configurá-las
    async function loadAllGeoJSONsAndSetupControls() {
        // Remove quaisquer camadas existentes do mapa antes de carregar novas
        for (const fileName in loadedGeojsonLayers) {
            if (mapa.hasLayer(loadedGeojsonLayers[fileName])) {
                mapa.removeLayer(loadedGeojsonLayers[fileName]);
            }
        }
        loadedGeojsonLayers = {}; // Limpa o objeto de camadas carregadas

        const initiallyVisibleLayers = [];

        // Itera sobre as configurações e carrega cada camada
        for (const config of geojsonLayerConfigs) {
            const layer = await loadAndAddGeoJSON(config.name, config.checked);
            if (layer && config.checked) {
                initiallyVisibleLayers.push(layer);
            }

            // Atualiza o estado do checkbox
            const checkbox = document.getElementById(`checkbox-${config.name.replace('.geojson', '')}`);
            if (checkbox) {
                checkbox.checked = config.checked;
            }
        }

        console.log("Camadas visíveis inicialmente para fitbounds:", initiallyVisibleLayers);
        
        // Ajusta o zoom do mapa para cobrir as camadas visíveis inicialmente
        if (initiallyVisibleLayers.length > 0) {
            const bounds = new L.featureGroup(initiallyVisibleLayers).getBounds();
            if (bounds.isValid()) {
                mapa.fitBounds(bounds);
            } else {
                console.warn("Bounds inválidos para as GeoJSONs carregadas. Talvez as coordenadas estejam fora da tela ou os arquivos estejam vazios.");
                mapa.setView([-11.276615, -37.447377], 12);
            }
        } else {
            console.warn("Nenhuma camada visível inicialmente.");
            mapa.setView([-11.276615, -37.447377], 12);
        }

        // Adiciona ouvintes de evento aos checkboxes
        checkboxes.forEach(checkbox => {
            checkbox.addEventListener('change', (event) => {
                const fileName = event.target.dataset.geojson;
                const isChecked = event.target.checked;
                const layer = loadedGeojsonLayers[fileName];

                if (layer) {
                    if (isChecked) {
                        layer.addTo(mapa); // Adiciona a camada ao mapa
                    } else {
                        mapa.removeLayer(layer); // Remove a camada do mapa
                    }
                } else {
                    console.warn(`Camada para ${fileName} não encontrada no objeto loadedGeojsonLayers.`);
                }
            });
        });
    }

    // --- Lógica de Autenticação Firebase ---
    // 'auth' está acessível aqui porque foi definida globalmente
    btnLogin.addEventListener('click', async () => {
        const email = emailInput.value;
        const password = senhaInput.value;
        mensagemErro.textContent = '';

        if (!email || !password) {
            mostrarErro('Por favor, preencha e-mail e senha.');
            return;
        }

        try {
            await auth.signInWithEmailAndPassword(email, password);
        } catch (error) {
            console.error("Erro no login:", error);
            switch (error.code) {
                case 'auth/invalid-email':
                    mostrarErro('E-mail inválido.');
                    break;
                case 'auth/user-disabled':
                    mostrarErro('Usuário desabilitado.');
                    break;
                case 'auth/user-not-found':
                case 'auth/wrong-password':
                    mostrarErro('E-mail ou senha incorretos.');
                    break;
                default:
                    mostrarErro(`Erro no login: ${error.message}`);
                    break;
            }
        }
    });

    btnLogout.addEventListener('click', async () => {
        try {
            await auth.signOut();
        } catch (error) {
            console.error("Erro no logout:", error);
            mostrarErro(`Erro no logout: ${error.message}`);
        }
    });

    auth.onAuthStateChanged(async (user) => {
        if (user) {
            console.log("Usuário logado:", user.email);
            loginContainer.style.display = 'none';
            mapaContainer.style.display = 'block';
            btnLogout.style.display = 'block';
            layerControl.style.display = 'block'; // Mostra o controle de camadas

            // MUDE esta chamada
            await loadAllGeoJSONsAndSetupControls();
            mapa.invalidateSize();

        } else {
            console.log("Usuário não logado.");
            loginContainer.style.display = 'block';
            mapaContainer.style.display = 'none';
            btnLogout.style.display = 'none';
            layerControl.style.display = 'none'; // Esconde o controle de camadas

            // Remove todas as camadas do mapa ao deslogar
            for (const fileName in loadedGeojsonLayers) {
                if (mapa.hasLayer(loadedGeojsonLayers[fileName])) {
                    mapa.removeLayer(loadedGeojsonLayers[fileName]);
                }
            }
            loadedGeojsonLayers = {}; // Limpa o objeto de camadas
        }
    });

}); // FIM DO DOMContentLoaded LISTENER
