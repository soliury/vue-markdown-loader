import Vue from 'vue'
import App from './app.vue'
import DemoBlock from './DemoBlock.vue'

Vue.component('demo-block', DemoBlock)

new Vue({
  el: '#app',
  render: h => h(App)
})
