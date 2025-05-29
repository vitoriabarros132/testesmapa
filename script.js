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
    var mapa = L.map('mapa').setView([-11.296345, -37.365581], 10);

    //-------------------------------------------------------------------
    // Adiciona a camada base do OpenStreetMap
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 20,
        attribution: '© OpenStreetMap'
    }).addTo(mapa);
    //-------------------------------------------------------------------
    
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
        { name: 'rede_mt.geojson', label: 'Rede MT', checked: false }, 
        { name: 'transformadores.geojson', label: 'Transformadores', checked: false }
    ];

    const popupDisplayConfigs = {
        'rede_mt.geojson': ['CTMT'],
        'postes.geojson': ['Poste', 'Tipo_Poste', 'Coord_X', 'Coord_Y'], 
        'chaves.geojson': ['NumPlaca', 'Coordenada', 'Coordena_1'], 
        'transformadores.geojson': ['NumPlaca', 'Fases', 'Potencia', 'Num_Serie'] 
    };
    
    // Definição de estilos e ícones para cada tipo de camada GeoJSON
    const layerStyles = {
        'rede_mt.geojson': {
            color: '#ee9722', // Laranja
            weight: 3,
            opacity: 0.7
        },
        'postes.geojson': {
            radius: 3, // Tamanho do ponto
            fillColor: '#9d9d9d', // Cor do ponto - Cinza escuro
            color: '#000', // Cor da borda - Preto
            weight: 1,
            opacity: 1,
            fillOpacity: 0.8
        },
        'chaves.geojson': {
            radius: 8,
            fillColor: '#3034a5', // Azul
            color: '#000',
            weight: 1,
            opacity: 1,
            fillOpacity: 0.8
        },
        'transformadores.geojson': {
            radius: 8, 
            fillColor: '#a53030', // Vermelho
            color: '#000',
            weight: 1,
            opacity: 1,
            fillOpacity: 0.8
        }
    };
    // Configuração dos atributos a serem usados como rótulos (tooltips permanentes)
    const labelAttributes = {
        'chaves.geojson': 'NumPlaca',
        'transformadores.geojson': 'NumPlaca'
    // Não precisamos configurar para rede_bt e rede_mt, pois não são pontos.
    // A visualização dos postes fica muito pesada, então não é mostrado.
    };
    //------------------------------------
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

        // Reprojetar para WGS84
        const reprojectedGeoJSON = reprojectGeoJSON(data, "EPSG:31984");
        const correctedGeoJSON = turf.rewind(reprojectedGeoJSON, { reverse: false });

        // Obter o estilo para o arquivo atual
        const style = layerStyles[fileName];

        const geoJsonOptions = {
            style: style,
            pointToLayer: function (feature, latlng) {
                const currentStyle = layerStyles[fileName];
                // Verifica o nome do arquivo
                if (fileName === 'postes.geojson') {
                    // === Postes: Quadrado ===
                    const size = 10; // Tamanho do lado do quadrado
                    const squareFillColor = currentStyle.fillColor || '#9d9d9d';
                    const squareBorderColor = currentStyle.color || '#000000';
                    const squareBorderSize = currentStyle.weight || 1;
                    const squareFillOpacity = currentStyle.fillOpacity || 1;

                    const iconHtml = `<div style="
                        background-color: ${squareFillColor};
                        width: ${size}px;
                        height: ${size}px;
                        border: ${squareBorderSize}px solid ${squareBorderColor};
                        opacity: ${squareFillOpacity};
                     "></div>`;

                    const squareIcon = L.divIcon({
                        className: 'custom-square-marker',
                        html: iconHtml,
                        iconSize: [size + squareBorderSize * 2, size + squareBorderSize * 2],
                        iconAnchor: [(size + squareBorderSize * 2) / 2, (size + squareBorderSize * 2) / 2]
                    });
                    return L.marker(latlng, { icon: squareIcon });

                 } else if (fileName === 'chaves.geojson') {
                    // === Chaves: Triângulo (usando CSS border tricks) ===
                    const size = 12; // Tamanho da base do triângulo
                    const triangleColor = currentStyle.fillColor || '#3034a5'; // Cor do triângulo
                    const triangleBorderColor = currentStyle.color || '#000000';
                    const triangleBorderSize = currentStyle.weight || 1;
                    const triangleOpacity = currentStyle.fillOpacity || 1; // Opacidade do triângulo
                    // Para criar um triângulo com CSS, usamos bordas de um div
                    // O triângulo apontará para cima. Ajuste as bordas conforme a direção desejada.
                    const iconHtml = `<div style="
                        width: 0;
                        height: 0;
                        border-left: ${size / 2}px solid transparent;
                        border-right: ${size / 2}px solid transparent;
                        border-bottom: ${size * 0.866}px solid ${triangleColor}; /* Altura do triângulo equilátero */
                        opacity: ${triangleOpacity};
                    "></div>`;
                    
                    const triangleIcon = L.divIcon({
                        className: 'custom-triangle-marker',
                        html: iconHtml,
                        // O iconSize e iconAnchor precisam ser ajustados para a forma do triângulo
                        iconSize: [size, size * 0.866], // Largura = base, Altura = altura do triângulo
                        iconAnchor: [size / 2, size * 0.866] // Âncora na parte inferior central do triângulo
                    });
                    return L.marker(latlng, { icon: triangleIcon });
                } else if (fileName === 'transformadores.geojson') {
                    // === Transformadores: Círculo (voltando a usar L.circleMarker) ===
                    // Verifica se o estilo existe e se tem as propriedades de ponto (radius, fillColor, etc.)
                    if (currentStyle && currentStyle.radius) {
                        return L.circleMarker(latlng, currentStyle);
                    }
                    // Fallback para o marcador padrão se o estilo não for válido para círculo
                    return L.marker(latlng);
                }

                // Fallback para outras geometrias (linhas, polígonos) ou se não for um dos pontos específicos
                // Para linhas e polígonos, o Leaflet aplica o 'style' diretamente.
                // Se for um ponto não especificado acima, retorna um marcador padrão.
                if (feature.geometry.type === 'Point') {
                    return L.marker(latlng); // Marcador padrão para outros pontos não configurados
                }
                return null; // Não cria marcador para outras geometrias (linhas/polígonos) se não houver um pointToLayer para elas
            },
                    
                if (style && style.radius) {
                    return L.circleMarker(latlng, style);
                }
                // Fallback para o marcador padrão se não for um ponto ou não tiver estilo de ponto
                return L.marker(latlng);
            },
            // AQUI COMEÇA A PROPRIEDADE onEachFeature, DENTRO DE geoJsonOptions
            onEachFeature: function (feature, layer) {
                if (feature.properties) {
                    let popupContent = '';
                    const allowedAttributes = popupDisplayConfigs[fileName] || Object.keys(feature.properties);                   
                    for (const key of allowedAttributes) {
                            if (feature.properties.hasOwnProperty(key) && feature.properties[key] !== null && feature.properties[key] !== undefined) {
                                popupContent += `<b>${key}:</b> ${feature.properties[key]}<br>`;
                            }
                    }
                    if (popupContent) {
                        layer.bindPopup(popupContent);
                    }

                    // === LÓGICA DO RÓTULO/TOOLTIP ===
                    const labelAttributeName = labelAttributes[fileName]; // Pega o nome do atributo de rótulo para este arquivo

                    if (feature.geometry.type === 'Point' && labelAttributeName && feature.properties[labelAttributeName]) {
                        const labelText = feature.properties[labelAttributeName].toString(); // Pega o valor do atributo específico

                        const tooltip = layer.bindTooltip(labelText, {
                            permanent: true, // Define se o rótulo é sempre visível
                            direction: 'top', // Posição do rótulo
                            className: 'point-label' // Classe CSS para estilização personalizada
                        });

                        // Adiciona um listener para o evento 'zoomend' do mapa
                        mapa.on('zoomend', function () {
                            // Acessa o elemento DOM do tooltip para mudar sua opacidade
                            if (tooltip._container) { // Verifica se o container existe (o tooltip precisa estar aberto/renderizado)
                                if (mapa.getZoom() < 17) {
                                    tooltip._container.style.opacity = 0; // Define opacidade via CSS
                                } else {
                                    tooltip._container.style.opacity = 1;
                                }
                            }
                        });

                        // Define o estado inicial do rótulo com base no zoom atual do mapa
                        if (tooltip._container) { // Verifica se o container existe
                            if (mapa.getZoom() < 17) {
                                tooltip._container.style.opacity = 0;
                            }
                        }
                    }
                    // ====================================
                } // Fecha o if (feature.properties)
            } // Fecha a função onEachFeature
        }; // Fecha o objeto geoJsonOptions

        // Armazena a camada no objeto, usando o nome do arquivo como chave
        const geoJsonLayer = L.geoJSON(correctedGeoJSON, geoJsonOptions);
        loadedGeojsonLayers[fileName] = geoJsonLayer;

        if (visible) {
            geoJsonLayer.addTo(mapa); // Adiciona ao mapa se for para ser visível
        }

        return geoJsonLayer; // Retorna a camada para ajuste de bounds, se necessário
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
                console.log(`Camada adicionada para fitBounds: ${config.name}`);
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
            const featureGroupForBounds = new L.featureGroup(initiallyVisibleLayers);
            const bounds = featureGroupForBounds.getBounds(); // Calcule os limites

            console.log("---------------------------------------");
            console.log("Camadas no featureGroup para bounds:", initiallyVisibleLayers);
            console.log("Objeto Bounds completo:", bounds); // Mostrar o objeto completo
            console.log("Bounds são válidos?", bounds.isValid());
            // Verifique se as coordenadas são números válidos e não NaN/Infinity
            console.log("Coordenadas SW (lat, lon):", bounds._southWest ? [bounds._southWest.lat, bounds._southWest.lng] : 'N/A');
            console.log("Coordenadas NE (lat, lon):", bounds._northEast ? [bounds._northEast.lat, bounds._northEast.lng] : 'N/A');
            console.log("---------------------------------------");
            
            if (bounds.isValid()) {
                mapa.fitBounds(bounds);
            } else {
                console.warn("Bounds inválidos para as GeoJSONs carregadas. Talvez as coordenadas estejam fora da tela ou os arquivos estejam vazios.");
                mapa.setView([-11.296345, -37.365581], 12);
            }
        } else {
            console.warn("Nenhuma camada visível inicialmente.");
            mapa.setView([-11.296345, -37.365581], 12);
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
