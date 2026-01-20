// main.js - Basic JavaScript for CV Builder

document.addEventListener('DOMContentLoaded', function() {
  
  // Проверка авторизации пользователя
  checkUserAuth();
  
  // Mobile menu toggle (for future implementation)
  const mobileMenuBtn = document.querySelector('.mobile-menu-btn');
  const navMenu = document.querySelector('.nav-menu');
  
  if (mobileMenuBtn) {
    mobileMenuBtn.addEventListener('click', function() {
      console.log('Mobile menu clicked - implement toggle functionality');
      // Future: Add mobile menu toggle functionality
    });
  }
  
  // Dropdown menu hover effects
  const dropdowns = document.querySelectorAll('.nav-dropdown');
  
  dropdowns.forEach(dropdown => {
    const menu = dropdown.querySelector('.nav-dropdown-menu');
    
    dropdown.addEventListener('mouseenter', function() {
      if (menu) {
        menu.style.opacity = '1';
        menu.style.visibility = 'visible';
        menu.style.transform = 'translateY(0)';
      }
    });
    
    dropdown.addEventListener('mouseleave', function() {
      if (menu) {
        menu.style.opacity = '0';
        menu.style.visibility = 'hidden';
        menu.style.transform = 'translateY(-10px)';
      }
    });
  });
  
  // Copy link functionality for share button
  const copyBtn = document.querySelector('.share-btn.copy');
  
  if (copyBtn) {
    copyBtn.addEventListener('click', function(e) {
      e.preventDefault();
      
      // Copy current URL to clipboard
      navigator.clipboard.writeText(window.location.href)
        .then(() => {
          const originalText = copyBtn.textContent;
          copyBtn.textContent = 'Скопировано!';
          copyBtn.style.background = '#10b981';
          
          setTimeout(() => {
            copyBtn.textContent = originalText;
            copyBtn.style.background = '';
          }, 2000);
        })
        .catch(() => {
          console.log('Clipboard API not supported');
        });
    });
  }
  
  // Smooth scroll for anchor links
  const anchorLinks = document.querySelectorAll('a[href^="#"]');
  
  anchorLinks.forEach(link => {
    link.addEventListener('click', function(e) {
      e.preventDefault();
      
      const targetId = this.getAttribute('href');
      const targetElement = document.querySelector(targetId);
      
      if (targetElement) {
        targetElement.scrollIntoView({
          behavior: 'smooth',
          block: 'start'
        });
      }
    });
  });
  
  // Add loading animation for CTA buttons
  const ctaButtons = document.querySelectorAll('.cta');
  
  ctaButtons.forEach(button => {
    button.addEventListener('click', function(e) {
      // Add subtle loading effect
      const originalText = this.textContent;
      this.style.opacity = '0.8';
      
      setTimeout(() => {
        this.style.opacity = '1';
      }, 200);
    });
  });
  
  // Simple analytics tracking (placeholder)
  function trackEvent(eventName, eventData) {
    console.log('Analytics Event:', eventName, eventData);
    // Future: Implement actual analytics tracking
  }
  
  // Track CTA clicks
  ctaButtons.forEach(button => {
    button.addEventListener('click', function() {
      trackEvent('cta_click', {
        button_text: this.textContent.trim(),
        page: window.location.pathname
      });
    });
  });
  
  // Track navigation clicks
  const navLinks = document.querySelectorAll('.nav-link, .dropdown-item a');
  
  navLinks.forEach(link => {
    link.addEventListener('click', function() {
      trackEvent('nav_click', {
        link_text: this.textContent.trim(),
        link_url: this.href
      });
    });
  });
  
});

// Проверка авторизации и обновление навигации
async function checkUserAuth() {
  try {
    const response = await fetch('/api/user');
    const result = await response.json();
    
    if (result.authenticated) {
      updateNavForAuthenticatedUser(result.user);
    }
  } catch (error) {
    console.log('Пользователь не авторизован');
  }
}

// Обновление навигации для авторизованного пользователя
function updateNavForAuthenticatedUser(user) {
  const navActions = document.querySelector('.nav-actions');
  if (navActions && !document.getElementById('userDropdown')) {
    navActions.innerHTML = `
      <div class="nav-dropdown" id="userDropdown">
        <button class="nav-dropdown-btn" type="button">
          <span>${user.firstName}</span>
          <span class="dropdown-arrow">▼</span>
        </button>
        <div class="nav-dropdown-menu">
          <div class="dropdown-item">
            <a href="/pages/dashboard">Личный кабинет</a>
          </div>
          <div class="dropdown-item">
            <a href="#" onclick="logout()">Выйти</a>
          </div>
        </div>
      </div>
      <a class="btn btn-primary cta" href="/pages/cv-builder">Создать резюме</a>
    `;
    
    // Добавляем обработчик для нового dropdown
    setupDropdowns();
  }
}

// Настройка dropdown меню
function setupDropdowns() {
  const dropdowns = document.querySelectorAll('.nav-dropdown');
  
  dropdowns.forEach(dropdown => {
    const menu = dropdown.querySelector('.nav-dropdown-menu');
    
    dropdown.addEventListener('mouseenter', function() {
      if (menu) {
        menu.style.opacity = '1';
        menu.style.visibility = 'visible';
        menu.style.transform = 'translateY(0)';
      }
    });
    
    dropdown.addEventListener('mouseleave', function() {
      if (menu) {
        menu.style.opacity = '0';
        menu.style.visibility = 'hidden';
        menu.style.transform = 'translateY(-10px)';
      }
    });
  });
}

// Функция выхода из системы
async function logout() {
  try {
    const response = await fetch('/api/logout', { method: 'POST' });
    const result = await response.json();
    
    if (result.success) {
      window.location.reload();
    }
  } catch (error) {
    console.error('Ошибка выхода:', error);
    window.location.reload();
  }
}

// Utility function to handle image loading errors
function handleImageError(img) {
  img.style.display = 'none';
  console.log('Image failed to load:', img.src);
}

// Add error handling for images when they load
window.addEventListener('load', function() {
  const images = document.querySelectorAll('img');
  
  images.forEach(img => {
    img.addEventListener('error', function() {
      handleImageError(this);
    });
  });
});