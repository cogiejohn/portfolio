const archiveUrl = "articles/archivedb.txt";
const featuredUrl = "articles/featureddb.txt";
const worksUrl = "articles/worksdb.txt";
const imageCaptionsUrl = "articles/imgcaptions.txt";

document.documentElement.style.setProperty("--stable-vh", `${window.innerHeight / 100}px`);

function archiveImageUrl(image) {
    return !image || image.toLowerCase() === "na"
        ? "styles/images/placeholder.png"
        : `styles/images/${image}`;
}

async function loadTextFile(url) {
    const response = await fetch(url, { cache: "no-store" });

    if (!response.ok) {
        throw new Error(`Could not load ${url}: ${response.status} ${response.statusText}`);
    }

    return response.text();
}

function parseArchive(text) {
    return text
        .split(/\r?\n/)
        .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
        .filter(({ line }) => line && line.toLowerCase() !== "id|img|header|title|date|type|publishedwhere|outlink")
        .map(({ line, lineNumber }) => {
            const fields = line.split("|").map(field => field.trim());

            if (fields.length !== 8 || fields.slice(0, 6).some(field => !field)) {
                throw new Error(
                    `Invalid archive record on line ${lineNumber}. Expected: id|img|header|title|date|type|publishedwhere|outlink`
                );
            }

            const [id, image, header, title, date, rawType, rawPublishedWhere, rawOutlink] = fields;
            const type = rawType.toLowerCase();
            const publishedWhere = rawPublishedWhere.toLowerCase() === "na" ? "" : rawPublishedWhere;

            if (!["self", "published"].includes(type)) {
                throw new Error(`Unknown article type "${rawType}" on archive line ${lineNumber}.`);
            }

            let outlink = "";
            if (rawOutlink && rawOutlink.toLowerCase() !== "na") {
                let parsedOutlink;
                try {
                    parsedOutlink = new URL(rawOutlink);
                } catch {
                    throw new Error(`Invalid article outlink on archive line ${lineNumber}.`);
                }

                if (!["http:", "https:"].includes(parsedOutlink.protocol)) {
                    throw new Error(`Article outlink on archive line ${lineNumber} must use HTTP or HTTPS.`);
                }
                outlink = parsedOutlink.href;
            }

            if (type === "published" && !outlink) {
                throw new Error(`Published article on archive line ${lineNumber} needs an outlink.`);
            }

            if (type === "published" && !publishedWhere) {
                throw new Error(`Published article on archive line ${lineNumber} needs a publication name.`);
            }

            return { id, image, header, title, date, type, publishedWhere, outlink };
        });
}

function parseFeatured(text) {
    const featured = {};

    text.split(/\r?\n/).forEach((line, index) => {
        const trimmedLine = line.trim();

        if (!trimmedLine) return;

        const separatorIndex = trimmedLine.indexOf(":");

        if (separatorIndex < 1) {
            throw new Error(
                `Invalid featured entry on line ${index + 1}. Expected: section:id`
            );
        }

        const section = trimmedLine.slice(0, separatorIndex).trim();
        const id = trimmedLine.slice(separatorIndex + 1).trim();

        if (!section || !id) {
            throw new Error(
                `Invalid featured entry on line ${index + 1}. Expected: section:id`
            );
        }

        featured[section] = id;
    });

    return featured;
}

function parseWorks(text) {
    return text
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean);
}

function parseImageCaptions(text) {
    const captions = new Map();

    text.split(/\r?\n/).slice(1).forEach(line => {
        const separatorIndex = line.indexOf("|");
        if (separatorIndex < 1) return;

        const image = line.slice(0, separatorIndex).trim();
        const caption = line.slice(separatorIndex + 1).trim();
        if (image && caption) {
            captions.set(image, caption);
        }
    });

    return captions;
}

function makeNavigable(element, link) {
    element.dataset.articleUrl = link;
    element.tabIndex = 0;
    element.setAttribute("role", "link");
    element.addEventListener("click", () => window.location.assign(link));
    element.addEventListener("keydown", event => {
        if (event.key === "Enter") {
            event.preventDefault();
            window.location.assign(link);
        }
    });
}

function articlePageUrl(id) {
    return `archive.html?id=${encodeURIComponent(id)}`;
}

async function loadOptionalArticle(id) {
    const response = await fetch(`articles/${encodeURIComponent(id)}.txt`, { cache: "no-store" });

    if (response.status === 404) {
        return "";
    }

    if (!response.ok) {
        throw new Error(`Could not load article ${id}: ${response.status} ${response.statusText}`);
    }

    return response.text();
}

function appendFormattedText(parent, text, templateDocument) {
    const markers = ["***", "~~", "**", "*"];
    let remaining = text;

    while (remaining) {
        let markerIndex = -1;
        let marker;
        for (const candidate of markers) {
            const index = remaining.indexOf(candidate);
            if (index !== -1 && (markerIndex === -1 || index < markerIndex)) {
                markerIndex = index;
                marker = candidate;
            }
        }

        if (markerIndex === -1 || !marker) {
            appendTextWithBreaks(parent, remaining, templateDocument);
            break;
        }

        appendTextWithBreaks(parent, remaining.slice(0, markerIndex), templateDocument);
        const contentStart = markerIndex + marker.length;
        const closingIndex = remaining.indexOf(marker, contentStart);
        if (closingIndex === -1) {
            appendTextWithBreaks(parent, remaining.slice(markerIndex, contentStart), templateDocument);
            remaining = remaining.slice(contentStart);
            continue;
        }

        const content = remaining.slice(contentStart, closingIndex);
        let formatted;
        let contentParent;
        if (marker === "~~") {
            formatted = templateDocument.createElement("span");
            formatted.style.fontSize = "1.15em";
            contentParent = formatted;
        } else if (marker === "*") {
            formatted = templateDocument.createElement("em");
            contentParent = formatted;
        } else if (marker === "**") {
            formatted = templateDocument.createElement("strong");
            contentParent = formatted;
        } else {
            formatted = templateDocument.createElement("strong");
            contentParent = templateDocument.createElement("em");
            formatted.append(contentParent);
        }

        appendFormattedText(contentParent, content, templateDocument);
        parent.append(formatted);
        remaining = remaining.slice(closingIndex + marker.length);
    }
}

function appendTextWithBreaks(parent, text, templateDocument) {
    text.split(/\r?\n/).forEach((line, index) => {
        if (index > 0) {
            parent.append(templateDocument.createElement("br"));
        }
        if (line) {
            parent.append(templateDocument.createTextNode(line));
        }
    });
}

async function displayArticle(record) {
    const templateUrl = record.type === "self" ? "self-template.html" : "published-template.html";
    const [templateText, articleText, captionsText] = await Promise.all([
        loadTextFile(templateUrl),
        loadOptionalArticle(record.id),
        loadTextFile(imageCaptionsUrl)
    ]);
    const templateDocument = new DOMParser().parseFromString(templateText, "text/html");
    templateDocument.querySelectorAll('link[rel="stylesheet"][href]').forEach(stylesheet => {
        const stylesheetUrl = new URL(stylesheet.getAttribute("href"), window.location.href).href;
        const alreadyLoaded = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
            .some(existingStylesheet => existingStylesheet.href === stylesheetUrl);

        if (!alreadyLoaded) {
            document.head.append(document.importNode(stylesheet, true));
        }
    });
    templateDocument.querySelectorAll('link[rel="icon"][href]').forEach(icon => {
        const iconLink = document.createElement("link");
        iconLink.rel = "icon";
        iconLink.href = new URL(icon.getAttribute("href"), window.location.href).href;
        if (icon.type) {
            iconLink.type = icon.type;
        }

        document.head.querySelectorAll('link[rel~="icon"]').forEach(existingIcon => existingIcon.remove());
        document.head.append(iconLink);
    });
    const articleHeader = templateDocument.querySelector("#article-header");
    const articleTitle = templateDocument.querySelector("#article-title");
    const imageContainer = templateDocument.querySelector("#article-image");
    const articleDate = templateDocument.querySelector("#article-date");

    if (!articleHeader || !articleDate) {
        throw new Error(`Article template ${templateUrl} is missing required article fields.`);
    }

    articleHeader.textContent = record.header;
    if (articleTitle) {
        articleTitle.textContent = record.title;
    }
    articleDate.textContent = record.date;

    const imageCaption = templateDocument.querySelector("#image-caption");
    if (!record.image || record.image.toLowerCase() === "na") {
        imageContainer?.remove();
        imageCaption?.remove();
    } else {
        if (!imageContainer) {
            throw new Error(`Article template ${templateUrl} is missing #article-image.`);
        }

        const image = templateDocument.createElement("img");
        image.src = `styles/images/${record.image}`;
        image.alt = record.title;
        imageContainer.replaceChildren(image);

        const caption = parseImageCaptions(captionsText).get(record.image);
        if (imageCaption && caption) {
            const markedLine = caption.match(/<([^<>]+)>/);
            if (markedLine && markedLine.index !== undefined) {
                const beforeMarker = caption.slice(0, markedLine.index).trim();
                const afterMarker = caption.slice(markedLine.index + markedLine[0].length).trim();
                const attribution = templateDocument.createElement("span");
                attribution.className = "image-caption-attribution";
                attribution.style.setProperty("display", "block", "important");
                attribution.textContent = markedLine[1].trim();

                imageCaption.replaceChildren(
                    templateDocument.createTextNode(beforeMarker),
                    attribution,
                    ...(afterMarker ? [templateDocument.createTextNode(` ${afterMarker}`)] : [])
                );
            } else {
                imageCaption.textContent = caption;
            }
        } else {
            imageCaption?.remove();
        }
    }

    const articleContent = templateDocument.querySelector("#article-content");
    const paragraphs = articleText
        .trim()
        .split(/\r?\n\s*\r?\n/)
        .map(paragraph => paragraph.trim())
        .filter(Boolean);

    if (articleContent && paragraphs.length) {
        articleContent.replaceChildren(...paragraphs.map(paragraph => {
            const element = templateDocument.createElement("p");
            appendFormattedText(element, paragraph, templateDocument);
            return element;
        }));
    } else {
        articleContent?.remove();
    }

    if (record.type === "published") {
        const outlinkButton = templateDocument.querySelector("#article-outlink");
        if (!outlinkButton) {
            throw new Error(`Published template ${templateUrl} is missing #article-outlink.`);
        }

        outlinkButton.href = record.outlink;
        outlinkButton.textContent = `Read in ${record.publishedWhere}`;
        outlinkButton.removeAttribute("target");
        outlinkButton.removeAttribute("rel");

        if (articleTitle) {
            const titleLink = templateDocument.createElement("a");
            titleLink.href = record.outlink;
            titleLink.style.color = "inherit";
            titleLink.style.textDecoration = "none";
            titleLink.textContent = record.title;
            articleTitle.replaceChildren(titleLink);
        }
    }

    document.title = record.title;
    document.body.replaceChildren(
        ...Array.from(templateDocument.body.childNodes, node => document.importNode(node, true))
    );
    window.scrollTo(0, 0);
}

function displayFeatured(sectionId, record, description) {
    const section = document.getElementById(sectionId);

    if (!section) {
        throw new Error(`Featured section #${sectionId} was not found.`);
    }

    const imageContainer = document.getElementById(`${sectionId}-img`);
    if (!imageContainer) {
        throw new Error(`Image container #${sectionId}-img was not found.`);
    }

    const image = document.createElement("img");
    image.src = archiveImageUrl(record.image);
    image.alt = record.title;
    imageContainer.replaceChildren(image);
    makeNavigable(imageContainer, articlePageUrl(record.id));

    const title = section.querySelector(".title");
    const date = section.querySelector(".date");

    if (!title || !date) {
        throw new Error(`Featured section #${sectionId} needs .title and .date elements.`);
    }

    title.textContent = record.title;
    date.textContent = `${record.header} | ${record.date}`;
    makeNavigable(title, articlePageUrl(record.id));
    makeNavigable(date, articlePageUrl(record.id));

    if (sectionId === "ftmain" && description) {
        const descriptionElement = section.querySelector(".description");

        if (!descriptionElement) {
            throw new Error("Featured main section needs a .description element.");
        }

        descriptionElement.textContent = description;
        makeNavigable(descriptionElement, articlePageUrl(record.id));
    }
}

function displayWorks(works, recordsById) {
    const worksContainer = document.getElementById("works");

    if (!worksContainer) {
        throw new Error('Works container "#works" was not found.');
    }

    const cards = works.map((recordId, index) => {
        const record = recordsById.get(recordId);

        if (!record) {
            throw new Error(
                `Work entry on line ${index + 1} references unknown archive ID "${recordId}".`
            );
        }

        const card = document.createElement("div");
        card.className = "shadow-dreamy worksworks";

        const image = document.createElement("img");
        image.src = archiveImageUrl(record.image);
        image.alt = record.title;
        image.className = "works-image";

        const title = document.createElement("h3");
        title.className = "works-title";
        title.textContent = record.title;

        const date = document.createElement("p");
        date.className = "works-date";
        date.textContent = `${record.header} | ${record.date}`;

        card.append(image, title, date);
        makeNavigable(card, articlePageUrl(record.id));
        return card;
    });

    worksContainer.replaceChildren(...cards);
}

async function initializeArchive() {
    const archiveText = await loadTextFile(archiveUrl);
    const archive = parseArchive(archiveText);
    const requestedId = new URLSearchParams(window.location.search).get("id");

    if (requestedId) {
        window.history.scrollRestoration = "manual";
        const record = archive.find(article => article.id === requestedId);
        if (!record) {
            throw new Error(`Article ID "${requestedId}" was not found in ${archiveUrl}.`);
        }

        await displayArticle(record);
        return;
    }

    const [featuredText, worksText] = await Promise.all([
        loadTextFile(featuredUrl),
        loadTextFile(worksUrl)
    ]);
    const featured = parseFeatured(featuredText);
    const works = parseWorks(worksText);
    const recordsById = new Map(archive.map(record => [record.id, record]));

    for (const sectionId of ["main", "side1", "side2"]) {
        const recordId = featured[sectionId];

        if (!recordId) {
            throw new Error(`No "${sectionId}" entry was found in ${featuredUrl}.`);
        }

        const record = recordsById.get(recordId);

        if (!record) {
            throw new Error(
                `Featured entry "${sectionId}:${recordId}" does not match an ID in ${archiveUrl}.`
            );
        }

        displayFeatured(`ft${sectionId}`, record, sectionId === "main" ? featured.desc : "");
    }

    displayWorks(works, recordsById);
}

initializeArchive().catch(error => {
    console.error("Could not initialize the archive:", error);

    const articleId = new URLSearchParams(window.location.search).get("id");
    if (articleId) {
        const message = document.createElement("p");
        message.className = "archive-error";
        message.setAttribute("role", "alert");
        message.textContent = "This article could not be loaded. Please return to the archive and try again.";
        document.body.replaceChildren(message);
        return;
    }

    const featureSection = document.getElementById("feature");

    if (featureSection) {
        const message = document.createElement("p");
        message.className = "archive-error";
        message.setAttribute("role", "alert");
        message.textContent =
            "The featured articles could not be loaded. Open this page through a local web server and check the articles text files.";
        featureSection.prepend(message);
    }
});
