import { HttpInterceptorFn } from '@angular/common/http';

/**
 * Auth interceptor — ensures cookies are sent with every request.
 * Like Spring's SecurityContext propagation in RestTemplate.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  // withCredentials ensures the auth cookie is sent cross-origin
  const authReq = req.clone({ withCredentials: true });
  return next(authReq);
};
