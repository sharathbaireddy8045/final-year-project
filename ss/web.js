document.addEventListener("DOMContentLoaded", () => {

    // ===============================
    // ELEMENT SELECTORS
    // ===============================
    const homeRsvpBtn = document.getElementById("home-rsvp-btn");
    const goToDecorBtn = document.getElementById("go-to-decor-for-selection-btn");
    const decorTab = document.getElementById("decor-tab");
    const rsvpTab = document.getElementById("rsvp-tab");

    const menuCheckboxes = document.querySelectorAll(".item-checkbox");
    const decorCheckboxes = document.querySelectorAll(".decor-checkbox");
    const selectDecorItemsBtn = document.getElementById("select-decor-items-btn");
    const dishesDecorSummary = document.getElementById("dishes-decor-summary");

    const totalCostDisplay = document.getElementById("total-cost-display");
    const advancePaymentDisplay = document.getElementById("advance-payment-display");
    const rsvpForm = document.getElementById("rsvp-form");
    const backToTopBtn = document.getElementById("back-to-top-btn");

    let currentTotalCost = 0;
    let currentAdvancePayment = 0;

    const imageModal = document.getElementById("imageModal");
    const modalImage = document.getElementById("modalImage");
    const captionText = document.getElementById("caption");
    const closeButton = document.querySelector(".close-button");

    const menuTitles = document.querySelectorAll(".menu-item-title");
    const mainDecorContent = document.getElementById("main-decor-content");
    const detailPage = document.getElementById("menu-item-detail-page");

    const detailTitle = document.getElementById("detail-item-title");
    const detailImage = document.getElementById("detail-item-image");
    const detailDescription = document.getElementById("detail-item-description");
    const additionalDetails = document.getElementById("additional-details");
    const backToMenuBtn = document.getElementById("back-to-menu-btn");

    // ===============================
    // HOME BUTTON TO RSVP
    // ===============================
    if (homeRsvpBtn) {
        homeRsvpBtn.addEventListener("click", () => {
            rsvpTab.checked = true;
            window.scrollTo({ top: 0, behavior: "smooth" });
        });
    }

    // ===============================
    // GO TO DECOR SECTION
    // ===============================
    if (goToDecorBtn) {
        goToDecorBtn.addEventListener("click", () => {
            decorTab.checked = true;
            window.scrollTo({ top: 0, behavior: "smooth" });
        });
    }

    // ===============================
    // VALIDATION FUNCTIONS
    // ===============================
    function validateBasicForm() {
        let isValid = true;
        const name = document.getElementById("name");
        const email = document.getElementById("email");
        const guests = document.getElementById("guests");

        const nameError = document.getElementById("name-error");
        const emailError = document.getElementById("email-error");
        const guestsError = document.getElementById("guests-error");

        if (nameError) nameError.textContent = "";
        if (emailError) emailError.textContent = "";
        if (guestsError) guestsError.textContent = "";

        if (!name || name.value.trim().length < 3) {
            if (nameError) nameError.textContent = "Name must contain at least 3 letters.";
            isValid = false;
        }

        const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!email || !emailPattern.test(email.value.trim())) {
            if (emailError) emailError.textContent = "Enter a valid email address.";
            isValid = false;
        }

        if (!guests || guests.value === "" || parseInt(guests.value) < 1) {
            if (guestsError) guestsError.textContent = "Minimum 1 guest required.";
            isValid = false;
        }

        return isValid;
    }

    // ===============================
    // SHOW QUANTITY INPUT WHEN CHECKED
    // ===============================
    menuCheckboxes.forEach((checkbox) => {
        checkbox.addEventListener("change", () => {
            const itemId = checkbox.dataset.itemId;
            const quantityBox = document.querySelector(`#${itemId}-qty`);
            if (!quantityBox) return;

            const quantityContainer = quantityBox.parentElement;

            if (checkbox.checked) {
                quantityContainer.style.display = "block";
                if (quantityBox.value === "0" || quantityBox.value === "") {
                    quantityBox.value = 1;
                }
            } else {
                quantityContainer.style.display = "none";
                quantityBox.value = 0;
            }
            updateSummary();
        });
    });

    // ===============================
    // DECOR CHECKBOX DISPLAY BUTTON
    // ===============================
    const allCheckboxes = document.querySelectorAll(".item-checkbox, .decor-checkbox");
    allCheckboxes.forEach((checkbox) => {
        checkbox.addEventListener("change", () => {
            const anyChecked = [...allCheckboxes].some(cb => cb.checked);
            if (selectDecorItemsBtn) {
                selectDecorItemsBtn.style.display = anyChecked ? "inline-block" : "none";
            }
            updateSummary();
        });
    });

    // ===============================
    // QUANTITY CHANGE
    // ===============================
    const quantityInputs = document.querySelectorAll(".item-quantity");
    quantityInputs.forEach((input) => {
        input.addEventListener("input", () => {
            if (input.value < 1 && input.value !== "") {
                input.value = 1;
            }
            updateSummary();
        });
    });

    // ===============================
    // UPDATE SUMMARY
    // ===============================
    function updateSummary() {
        let summaryText = "";
        let totalCost = 0;

        menuCheckboxes.forEach((checkbox) => {
            if (checkbox.checked) {
                const itemName = checkbox.dataset.itemName;
                const itemCost = parseInt(checkbox.dataset.itemCost);
                const itemId = checkbox.dataset.itemId;
                const qtyInput = document.getElementById(`${itemId}-qty`);
                const quantity = qtyInput ? parseInt(qtyInput.value) || 0 : 0;
                const subtotal = itemCost * quantity;

                totalCost += subtotal;
                summaryText += `${itemName} x ${quantity} = ₹${subtotal}\n`;
            }
        });

        decorCheckboxes.forEach((checkbox) => {
            if (checkbox.checked) {
                const decorName = checkbox.dataset.itemName;
                const decorCost = parseInt(checkbox.dataset.itemCost);
                totalCost += decorCost;
                summaryText += `${decorName} = ₹${decorCost}\n`;
            }
        });

        if (dishesDecorSummary) dishesDecorSummary.value = summaryText;
        if (totalCostDisplay) totalCostDisplay.textContent = `Total Estimated Cost: ₹${totalCost}`;
        
        const advance = Math.round(totalCost * 0.30);
        currentTotalCost = totalCost;
        currentAdvancePayment = advance;
        if (advancePaymentDisplay) advancePaymentDisplay.textContent = `Advance Payment (30%): ₹${advance}`;
    }

    // ===============================
    // SELECTED ITEMS SNAPSHOT
    // ===============================
    function collectSelectedItems() {
        const items = [];

        menuCheckboxes.forEach((checkbox) => {
            if (!checkbox.checked) return;
            const qtyInput = document.getElementById(`${checkbox.dataset.itemId}-qty`);
            const quantity = qtyInput ? parseInt(qtyInput.value) || 0 : 0;
            const cost = parseInt(checkbox.dataset.itemCost) || 0;
            items.push({
                id: checkbox.dataset.itemId,
                name: checkbox.dataset.itemName,
                type: "dish",
                quantity: quantity,
                cost: cost,
                subtotal: cost * quantity
            });
        });

        decorCheckboxes.forEach((checkbox) => {
            if (!checkbox.checked) return;
            const cost = parseInt(checkbox.dataset.itemCost) || 0;
            items.push({
                id: checkbox.dataset.itemId,
                name: checkbox.dataset.itemName,
                type: "decor",
                quantity: 1,
                cost: cost,
                subtotal: cost
            });
        });

        return items;
    }

    // ===============================
    // LOCAL FALLBACK (only if db.js could not load)
    // ===============================
    function saveRsvpLocally(payload) {
        let list = [];
        let user = null;

        try { list = JSON.parse(localStorage.getItem("blissRsvps") || "[]"); } catch (e) { list = []; }
        if (!Array.isArray(list)) list = [];

        try { user = JSON.parse(localStorage.getItem("blissUser") || "null"); } catch (e) { user = null; }

        const id = "LOCAL-" + Date.now().toString(36).toUpperCase() + "-" +
            Math.random().toString(36).slice(2, 6).toUpperCase();

        list.unshift(Object.assign({
            id: id,
            createdAt: new Date().toISOString(),
            status: "pending",
            userId: (user && user.uid) || ("local-" + ((user && user.email) || "guest")),
            userEmail: (user && user.email) || "",
            userName: (user && user.name) || "",
            anonymous: !user || user.type === "guest"
        }, payload));

        try { localStorage.setItem("blissRsvps", JSON.stringify(list.slice(0, 50))); } catch (e) {}

        return { id: id, local: true };
    }

    // ===============================
    // SELECT ITEMS BUTTON
    // ===============================
    if (selectDecorItemsBtn) {
        selectDecorItemsBtn.addEventListener("click", () => {
            rsvpTab.checked = true;
            window.scrollTo({ top: 0, behavior: "smooth" });
        });
    }

    // ===============================
    // RSVP EMAIL DELIVERY
    // ===============================
    const RSVP_MAIL_TO = "sharath.baireddy@gmail.com";

    // Free access key from https://web3forms.com (create it with the Gmail
    // address above). Once pasted here, every RSVP is emailed automatically.
    // While it is empty, submitting opens a pre-filled Gmail draft instead.
    const RSVP_MAIL_KEY = "";

    function formatRupees(value) {
        return "₹" + Number(value || 0).toLocaleString("en-IN");
    }

    function rsvpMailSubject(payload) {
        return "New RSVP from " + payload.name + " — Bliss Bloom Events";
    }

    function rsvpMailBody(payload) {
        return [
            "Name: " + payload.name,
            "Email: " + payload.email,
            "Guests: " + payload.guests,
            "",
            "Selected dishes & decor:",
            payload.itemsSummary,
            "",
            "Total cost: " + formatRupees(payload.totalCost),
            "Advance payment: " + formatRupees(payload.advancePayment),
            "Submitted: " + new Date().toLocaleString("en-IN")
        ].join("\n");
    }

    function gmailComposeUrl(payload) {
        return "https://mail.google.com/mail/?view=cm&fs=1" +
            "&to=" + encodeURIComponent(RSVP_MAIL_TO) +
            "&su=" + encodeURIComponent(rsvpMailSubject(payload)) +
            "&body=" + encodeURIComponent(rsvpMailBody(payload));
    }

    function openMailDraft(payload) {
        try {
            const draft = window.open(gmailComposeUrl(payload), "_blank");
            return !!draft;
        } catch (error) {
            return false;
        }
    }

    /**
     * Firestore can retry silently for a long time when the API is disabled, so
     * the booking save is capped to keep the submit button responsive.
     */
    function withTimeout(promise, ms) {
        return Promise.race([
            promise,
            new Promise((resolve, reject) => {
                setTimeout(() => reject(new Error("The online database did not respond in time.")), ms);
            })
        ]);
    }

    /**
     * Emails the RSVP to the organiser through Web3Forms (a static-site friendly
     * mail relay). Failures are reported to the caller so the guest still gets a
     * Gmail draft fallback.
     */
    async function sendRsvpEmail(payload) {
        if (!RSVP_MAIL_KEY) return { ok: false, skipped: true };

        const controller = typeof AbortController === "function" ? new AbortController() : null;
        const timer = controller ? setTimeout(() => controller.abort(), 12000) : null;

        try {
            const response = await fetch("https://api.web3forms.com/submit", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Accept": "application/json"
                },
                body: JSON.stringify({
                    access_key: RSVP_MAIL_KEY,
                    subject: rsvpMailSubject(payload),
                    from_name: "Bliss Bloom Events",
                    replyto: payload.email,
                    Name: payload.name,
                    Email: payload.email,
                    Guests: payload.guests,
                    "Selected dishes & decor": payload.itemsSummary,
                    "Total cost": formatRupees(payload.totalCost),
                    "Advance payment": formatRupees(payload.advancePayment),
                    Submitted: new Date().toLocaleString("en-IN"),
                    message: rsvpMailBody(payload),
                    botcheck: false
                }),
                signal: controller ? controller.signal : undefined
            });

            let data = null;
            try { data = await response.json(); } catch (error) { data = null; }

            return {
                ok: !!(response.ok && data && data.success),
                message: (data && data.message) || ""
            };
        } catch (error) {
            return { ok: false, message: "" };
        } finally {
            if (timer) clearTimeout(timer);
        }
    }

    // ===============================
    // RSVP FORM SUBMISSION
    // ===============================
    if (rsvpForm) {
        rsvpForm.addEventListener("submit", async (e) => {
            e.preventDefault();

            const itemsError = document.getElementById("items-error");
            const submitError = document.getElementById("submit-error");
            const successBox = document.getElementById("booking-success");
            const submitBtn = rsvpForm.querySelector('button[type="submit"]');

            if (itemsError) itemsError.textContent = "";
            if (submitError) submitError.textContent = "";
            if (successBox) {
                successBox.hidden = true;
                successBox.textContent = "";
            }

            if (!validateBasicForm()) return;

            if (!dishesDecorSummary || dishesDecorSummary.value.trim() === "") {
                if (itemsError) itemsError.textContent = "Please select at least one dish or decoration item.";
                return;
            }

            const payload = {
                name: document.getElementById("name").value.trim(),
                email: document.getElementById("email").value.trim(),
                guests: parseInt(document.getElementById("guests").value, 10) || 1,
                itemsSummary: dishesDecorSummary.value.trim(),
                items: collectSelectedItems(),
                totalCost: currentTotalCost,
                advancePayment: currentAdvancePayment
            };

            // Without a Web3Forms key, prepare a Gmail draft while the click is
            // still active so the browser permits the new tab.
            let draftOpened = false;
            if (!RSVP_MAIL_KEY) draftOpened = openMailDraft(payload);

            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.textContent = "Sending your RSVP…";
            }

            // Mail the RSVP to the organiser. This runs independently of the
            // database so a Firestore failure never loses the enquiry.
            const mailResult = await sendRsvpEmail(payload);

            let saved = null;
            let saveError = null;
            try {
                saved = (window.BlissDB && typeof window.BlissDB.addRsvp === "function")
                    ? await withTimeout(window.BlissDB.addRsvp(payload), 8000)
                    : saveRsvpLocally(payload);
            } catch (error) {
                saveError = error;
            }

            function addNote(text) {
                const note = document.createElement("span");
                note.textContent = text;
                if (successBox) successBox.appendChild(note);
            }

            try {
                if (saved) {
                    if (successBox) {
                        successBox.hidden = false;
                        successBox.textContent = "RSVP saved successfully. Booking ID: " + saved.id;
                        addNote(saved.local
                            ? "Saved on this device in demo mode. Add your Firebase keys to store bookings online."
                            : "We have saved your booking. Our team will contact you shortly.");
                        addNote(mailResult.ok
                            ? "A copy of your RSVP was emailed to the event team."
                            : draftOpened
                                ? "A pre-filled email to the event team is open in a new tab — press Send to deliver it."
                                : "Use “Send this RSVP by email” below so the event team receives it.");
                    }

                    if (!mailResult.ok && !draftOpened && successBox) {
                        const link = document.createElement("a");
                        link.href = gmailComposeUrl(payload);
                        link.target = "_blank";
                        link.rel = "noopener";
                        link.textContent = "Send this RSVP by email";
                        link.style.display = "inline-block";
                        link.style.marginTop = "8px";
                        successBox.appendChild(link);
                    }
                } else if (mailResult.ok) {
                    if (successBox) {
                        successBox.hidden = false;
                        successBox.textContent = "Your RSVP was emailed to the event team.";
                        addNote("It could not be saved to the online database right now, but we have your details.");
                    }
                } else if (draftOpened) {
                    if (successBox) {
                        successBox.hidden = false;
                        successBox.textContent = "Your RSVP email is ready in a new tab — press Send to deliver it.";
                        addNote((saveError && saveError.message) || "The online copy could not be saved.");
                    }
                } else if (submitError) {
                    const reason = (saveError && saveError.message) || "Could not save your RSVP.";
                    submitError.textContent = reason + " Email delivery also failed, so please try again.";
                }

                if (saved || mailResult.ok || draftOpened) {
                    rsvpForm.reset();

                    if (dishesDecorSummary) dishesDecorSummary.value = "";
                    if (totalCostDisplay) totalCostDisplay.textContent = "";
                    if (advancePaymentDisplay) advancePaymentDisplay.textContent = "";
                    currentTotalCost = 0;
                    currentAdvancePayment = 0;

                    allCheckboxes.forEach((checkbox) => checkbox.checked = false);
                    quantityInputs.forEach((input) => {
                        input.value = 0;
                        input.parentElement.style.display = "none";
                    });

                    if (selectDecorItemsBtn) selectDecorItemsBtn.style.display = "none";
                }
            } finally {
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.textContent = "Submit RSVP";
                }
            }
        });
    }

    // ===============================
    // BACK TO TOP BUTTON
    // ===============================
    window.addEventListener("scroll", () => {
        if (!backToTopBtn) return;
        if (document.body.scrollTop > 200 || document.documentElement.scrollTop > 200) {
            backToTopBtn.style.display = "block";
        } else {
            backToTopBtn.style.display = "none";
        }
    });

    if (backToTopBtn) {
        backToTopBtn.addEventListener("click", () => {
            window.scrollTo({ top: 0, behavior: "smooth" });
        });
    }

    // ===============================
    // IMAGE MODAL
    // ===============================
    const allImages = document.querySelectorAll(".menu-item img, .decor-item img");
    allImages.forEach((img) => {
        img.addEventListener("click", (e) => {
            // Prevent conflict if clicking titles or checkboxes near images
            if(e.target.tagName !== 'IMG') return;
            
            if (imageModal && modalImage && captionText) {
                imageModal.style.display = "flex";
                modalImage.src = img.src;
                captionText.textContent = img.alt || "Event Gallery";
            }
        });
    });

    if (closeButton) {
        closeButton.addEventListener("click", () => {
            imageModal.style.display = "none";
        });
    }

    if (imageModal) {
        imageModal.addEventListener("click", (e) => {
            if (e.target === imageModal) {
                imageModal.style.display = "none";
            }
        });
    }

    // ===============================
    // MENU DETAIL PAGES DATA MAP
    // ===============================
    const itemDetails = {
        "spring-rolls": { title: "Spring Rolls", description: "Crispy spring rolls stuffed with vegetables and served hot.", details: "Includes cabbage, carrots, beans, and spicy sauce." },
        "chicken-tikka": { title: "Chicken Tikka", description: "Marinated chicken grilled using Indian spices.", details: "Served with mint chutney and onion rings." },
        "bruschetta": { title: "Bruschetta", description: "Italian toasted bread topped with tomatoes and herbs.", details: "Prepared with olive oil and basil." },
        "paneer-butter-masala": { title: "Paneer Butter Masala", description: "Creamy tomato gravy with soft paneer cubes.", details: "Served with butter roti." },
        "butter-chicken": { title: "Butter Chicken", description: "Tender chicken in rich creamy gravy.", details: "Served with steamed rice." },
        "pasta-alfredo": { title: "Pasta Alfredo", description: "Creamy Alfredo pasta with parmesan cheese.", details: "Italian style white sauce pasta." },
        "jeera-rice": { title: "Jeera Rice", description: "Basmati rice flavored with cumin.", details: "Light and aromatic rice dish." },
        "garlic-naan": { title: "Garlic Naan", description: "Soft naan topped with garlic butter.", details: "Best paired with curries." },
        "chocolate-brownie": { title: "Chocolate Brownie", description: "Rich chocolate dessert.", details: "Served with vanilla ice cream." },
        "rasmalai": { title: "Rasmalai", description: "Soft cheese balls in saffron milk.", details: "Traditional Indian dessert." },
        "cheesecake": { title: "Cheesecake", description: "Creamy baked cheesecake dessert.", details: "Buttery biscuit crust." },
        "mojito": { title: "Mojito", description: "Refreshing mint-based cold beverage.", details: "Contains lemon and soda." },
        "masala-chai": { title: "Masala Chai", description: "Traditional Indian spiced tea.", details: "Prepared with aromatic spices." },
        "cold-coffee": { title: "Cold Coffee", description: "Chilled coffee with chocolate flavor.", details: "Served cold with ice cream topping." }
    };

    menuTitles.forEach((title) => {
        title.addEventListener("click", () => {
            const itemId = title.dataset.itemId;
            const parent = title.closest(".menu-item");
            if (!parent) return;
            const image = parent.querySelector("img");
            const item = itemDetails[itemId];

            if (item && mainDecorContent && detailPage) {
                mainDecorContent.style.display = "none";
                detailPage.style.display = "flex";

                if (detailTitle) detailTitle.textContent = item.title;
                if (detailImage && image) detailImage.src = image.src;
                if (detailDescription) detailDescription.textContent = item.description;
                if (additionalDetails) additionalDetails.textContent = item.details;
            }
        });
    });

    if (backToMenuBtn) {
        backToMenuBtn.addEventListener("click", () => {
            if (detailPage && mainDecorContent) {
                detailPage.style.display = "none";
                mainDecorContent.style.display = "block";
                window.scrollTo({ top: 0, behavior: "smooth" });
            }
        });
    }
});