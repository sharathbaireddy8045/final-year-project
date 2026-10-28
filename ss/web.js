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
            if (!validateBasicForm()) return;
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
        if (advancePaymentDisplay) advancePaymentDisplay.textContent = `Advance Payment (30%): ₹${advance}`;
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
    // RSVP FORM SUBMISSION
    // ===============================
    if (rsvpForm) {
        rsvpForm.addEventListener("submit", (e) => {
            e.preventDefault();
            const itemsError = document.getElementById("items-error");
            if (itemsError) itemsError.textContent = "";

            if (!validateBasicForm()) return;

            if (!dishesDecorSummary || dishesDecorSummary.value.trim() === "") {
                if (itemsError) itemsError.textContent = "Please select at least one dish or decoration item.";
                return;
            }

            alert("RSVP Submitted Successfully!\n\nThank you for booking with us.");
            rsvpForm.reset();

            if (dishesDecorSummary) dishesDecorSummary.value = "";
            if (totalCostDisplay) totalCostDisplay.textContent = "";
            if (advancePaymentDisplay) advancePaymentDisplay.textContent = "";

            allCheckboxes.forEach((checkbox) => checkbox.checked = false);
            quantityInputs.forEach((input) => {
                input.value = 0;
                input.parentElement.style.display = "none";
            });

            if (selectDecorItemsBtn) selectDecorItemsBtn.style.display = "none";
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
                detailPage.style.display = "block";

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